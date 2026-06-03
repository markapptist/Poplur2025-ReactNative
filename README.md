# Poplur2025 React Native Conversion

This is a React Native / Expo conversion of the uploaded `Poplur2025-iOS` SwiftUI project.

## What was converted

- Welcome / Login / Sign Up auth gate
- Firebase Auth listener
- Firestore `posts` collection model
- Firebase Storage media uploads
- Feed with image/video posts
- Map with markers and radius circles
- Tap-map-to-select-coordinate posting flow
- Camera screen with photo capture, 10-second video recording, torch, flip camera, gallery picker, and profile posting
- Profile screen with user stats, edit profile, logout, and post grid
- Settings screen describing native equivalents
- iOS-style cube tab overlay: Record / Feed / Profile / Map, defaulting to Feed

## Important setup notes

1. Install dependencies:

```bash
npm install
```

2. Start the project:

```bash
npx expo start
```

3. For native performance testing:

```bash
npx expo run:ios
npx expo run:android
```

4. Firebase config:

The Firebase project values were copied from the iOS `GoogleService-Info.plist`. For the Firebase JS SDK, the best production setup is to create a Firebase Web App inside the same Firebase project and replace the placeholder `appId` in `src/services/firebase.ts`.

5. Google Maps:

`react-native-maps` is included. For Android/iOS production builds, add your Google Maps API keys to the native config after prebuild, or configure Expo build properties.

## Compared with the native iOS version

This project is intended as a cross-platform performance comparison, not a perfect 1:1 native rewrite. The hardest native iOS features were mapped like this:

| iOS feature | React Native equivalent |
|---|---|
| SwiftUI | React Native components |
| FirebaseAuth | Firebase JS Auth |
| Firestore | Firebase JS Firestore |
| FirebaseStorage | Firebase JS Storage |
| MapKit radius overlays | react-native-maps `Circle` overlays |
| AVFoundation/CameraKit | Expo Camera |
| UIKit media picker | Expo Image Picker |
| SceneKit cube tab | Animated React Native cube approximation |
| SpriteKit/AR filters/CoreML | Not fully ported; add native modules or VisionCamera frame processors later |

## Recommended next steps

- Test camera startup and recording on real devices.
- Replace Expo Camera with `react-native-vision-camera` if you need CoreML/frame processors or higher-performance capture.
- Add real Firebase Web app config.
- Add Google Maps API keys.
- Move video cropping/compression into a native module or FFmpeg package if 9:16 export is required.
# Poplur2025-ReactNative
