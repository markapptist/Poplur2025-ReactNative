export type AppTab = 'map' | 'record' | 'feed' | 'profile' | 'settings';

export type Post = {
  photoViewSeconds?: number;
  id: string;
  userID: string;
  username?: string;
  mediaURL: string;
  mediaType: 'photo' | 'video' | 'photo_profile' | 'video_profile' | string;
  posterURL?: string;
  caption?: string;
  channelId?: string;
  latitude?: number;
  longitude?: number;
  radius: number;
  viewCount: number;
  createdAtMillis?: number;
  locationVisibility?: 'approximate' | 'hidden';
  syntheticJourney?: 'first-user-v1' | 'first-user-shared-v1';
  createdAt?: Date | null;
};

export type UserProfile = {
  uid: string;
  username: string;
  email: string;
  accountType?: 'personal' | 'business' | string;
  photoURL?: string;
  bio?: string;
};
