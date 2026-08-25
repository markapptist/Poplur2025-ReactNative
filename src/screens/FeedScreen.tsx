import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, RefreshControl, StyleSheet, Text, useWindowDimensions, View, ViewToken } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { fetchRecentPosts, incrementPostView } from '../services/posts';
import type { Post } from '../types/models';
import { usePoplurHeavyRenderer, usePoplurPerformance } from '../performance/PoplurPerformance';
import { PoplurPerformanceMode } from '../performance/PoplurPerformanceManager';

const EARTH_RADIUS_KM = 6371;

export function FeedScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const viewedPosts = useRef(new Set<string>());
  const { height } = useWindowDimensions();
  const performance = usePoplurPerformance();
  const hasActiveVideo = posts.some(post => post.id === activePostId
    && (post.mediaType.includes('video') || post.mediaURL.toLowerCase().includes('.mp4')));
  const ownsVideoRenderer = usePoplurHeavyRenderer(
    'feed-active-video',
    hasActiveVideo,
    { priority: 70, decorative: false },
  );
  const videoPlaybackAllowed = ownsVideoRenderer && performance.mode !== PoplurPerformanceMode.EMERGENCY;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextPosts = await fetchRecentPosts();
      setPosts(nextPosts);
      setActivePostId(current => current ?? nextPosts[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 72 }), []);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const next = viewableItems[0]?.item as Post | undefined;
    if (!next) return;
    setActivePostId(next.id);
    if (!viewedPosts.current.has(next.id)) {
      viewedPosts.current.add(next.id);
      incrementPostView(next).catch(() => {});
    }
  });

  if (loading && posts.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="white" />
        <Text style={styles.muted}>Loading feed...</Text>
      </View>
    );
  }

  if (!loading && posts.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Feed</Text>
        <Text style={styles.emptyCopy}>Your posts will flip through here once you add content.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={posts}
      keyExtractor={item => item.id}
      renderItem={({ item, index }) => (
        <FeedPost post={item} index={index} totalPosts={posts.length} height={height} active={videoPlaybackAllowed && item.id === activePostId} />
      )}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      snapToInterval={height}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#fff" />}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged.current}
      getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
      style={styles.feed}
    />
  );
}

function FeedPost({ post, index, totalPosts, height, active }: { post: Post; index: number; totalPosts: number; height: number; active: boolean }) {
  const isVideo = post.mediaType.includes('video') || post.mediaURL.toLowerCase().includes('.mp4');
  const radiusKm = Math.max(1, Math.round(post.radius / 1000));
  const username = post.username?.replace(/^@/, '') || 'poplur_user';
  const location = post.latitude !== undefined && post.longitude !== undefined
    ? 'Approximate map area'
    : 'No public map origin';

  return (
    <View style={[styles.post, { height }]}>
      {isVideo && active ? (
        <Video
          source={{ uri: post.mediaURL }}
          style={styles.media}
          resizeMode={ResizeMode.COVER}
          shouldPlay={active}
          isLooping
          isMuted={false}
          progressUpdateIntervalMillis={1000}
        />
      ) : isVideo ? (
        <View style={styles.media} />
      ) : (
        <Image source={{ uri: post.mediaURL }} style={styles.media} resizeMode="cover" />
      )}
      <View pointerEvents="none" style={styles.scrim} />

      <View style={styles.header}>
        <View style={styles.headerIcons}>
          <View style={styles.smallBadge}>
            <Ionicons name="flag" size={25} color="#d94668" />
          </View>
          <View style={styles.foodBadge}>
            <Ionicons name="fast-food" size={34} color="#f4b23c" />
          </View>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.username}>User {username}</Text>
          <Text style={styles.location}>{location}</Text>
        </View>
      </View>

      <View style={styles.trending}>
        <Text style={styles.sectionLabel}>TRENDING</Text>
        <Ionicons name="arrow-up" size={74} color="#63d669" />
        <View style={styles.metricRule} />
        <Text style={styles.postCount}>{post.viewCount}</Text>
        <Text style={styles.metricSubtext}>posts</Text>
      </View>

      <View style={styles.radius}>
        <View style={styles.radiusHeader}>
          <Text style={styles.sectionLabel}>RADIUS</Text>
          <Ionicons name="shield-half-outline" size={24} color="rgba(255,255,255,0.78)" />
        </View>
        <Text style={styles.radiusNumber}>{radiusKm}</Text>
        <View style={styles.radiusRule} />
        <Text style={styles.radiusMax}>{EARTH_RADIUS_KM}</Text>
        <Text style={styles.km}>km</Text>
      </View>

      <View style={styles.feedBadge}>
        <Ionicons name="list" size={44} color="#8f94d7" />
        <Text style={styles.feedBadgeText}>Feed</Text>
      </View>

      <View style={styles.pageDots}>
        {Array.from({ length: totalPosts }).slice(0, 6).map((_, dotIndex) => (
          <View key={dotIndex} style={[styles.dot, dotIndex === index && styles.activeDot]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  feed: {
    flex: 1,
    backgroundColor: '#000'
  },
  center: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center'
  },
  muted: {
    color: 'rgba(255,255,255,0.72)',
    marginTop: 10,
    fontWeight: '700'
  },
  empty: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 38,
    fontWeight: '900'
  },
  emptyCopy: {
    color: 'rgba(255,255,255,0.72)',
    marginTop: 12,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 23
  },
  post: {
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden'
  },
  media: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%'
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)'
  },
  header: {
    position: 'absolute',
    left: 34,
    right: 24,
    top: 136,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'flex-start'
  },
  headerIcons: {
    width: 126,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingTop: 4
  },
  smallBadge: {
    width: 54,
    height: 38,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.88)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  foodBadge: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center'
  },
  headerText: {
    flex: 1
  },
  username: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 39,
    textShadowColor: 'rgba(0,0,0,0.32)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 2 }
  },
  location: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 3,
    textShadowColor: 'rgba(0,0,0,0.26)',
    textShadowRadius: 8
  },
  trending: {
    position: 'absolute',
    left: 58,
    bottom: 236,
    width: 180,
    alignItems: 'flex-start'
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: 4
  },
  metricRule: {
    width: 144,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.92)',
    marginTop: 4,
    marginBottom: 10
  },
  postCount: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '900',
    lineHeight: 62
  },
  metricSubtext: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 26,
    fontWeight: '900',
    marginTop: 4
  },
  radius: {
    position: 'absolute',
    right: 34,
    bottom: 94,
    width: 220,
    alignItems: 'flex-end'
  },
  radiusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10
  },
  radiusNumber: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 62,
    fontWeight: '900',
    lineHeight: 68
  },
  radiusRule: {
    width: 154,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.72)',
    marginTop: 6,
    marginBottom: 5
  },
  radiusMax: {
    color: '#fff',
    fontSize: 50,
    fontWeight: '900',
    lineHeight: 56
  },
  km: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 2
  },
  feedBadge: {
    position: 'absolute',
    left: '50%',
    bottom: 134,
    width: 116,
    height: 116,
    marginLeft: -58,
    borderRadius: 22,
    backgroundColor: '#20223b',
    borderColor: 'rgba(11,35,59,0.9)',
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center'
  },
  feedBadgeText: {
    color: '#9da2df',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 6
  },
  pageDots: {
    position: 'absolute',
    right: 12,
    top: '48%',
    gap: 8
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.36)'
  },
  activeDot: {
    backgroundColor: '#fff'
  }
});
