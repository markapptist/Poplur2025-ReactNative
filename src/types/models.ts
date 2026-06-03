export type AppTab = 'map' | 'record' | 'feed' | 'profile' | 'settings';

export type Post = {
  id: string;
  userID: string;
  username?: string;
  mediaURL: string;
  mediaType: 'photo' | 'video' | 'photo_profile' | 'video_profile' | string;
  latitude?: number;
  longitude?: number;
  radius: number;
  viewCount: number;
  createdAt?: Date | null;
};

export type UserProfile = {
  uid: string;
  username: string;
  email: string;
  photoURL?: string;
  bio?: string;
};
