import React from 'react';
import { PreloginWebScreen } from './PreloginWebScreen';

// Keep auth resolution on the approved barber-pole/video splash instead of
// showing the former RN-only loading screen.
export function SplashScreen() {
  return <PreloginWebScreen splashOnly />;
}
