# iOS to React Native Conversion Notes

Source uploaded: `Poplur2025-iOS(3).zip`

## iOS files reviewed

The conversion was based on the main Swift files in `Poplur2025/`, especially:

- `Poplur2025App.swift`
- `LaunchGate.swift`
- `WelcomeView.swift`
- `LoginView.swift`
- `SignUpView.swift`
- `HomeView.swift`
- `CubeTabView.swift`
- `AppTab.swift`
- `FeedView.swift`
- `FeedVideoView.swift`
- `MapView.swift`
- `MediaPickerView.swift`
- `CameraKitController.swift`
- `CameraView.swift`
- `ProfileView.swift`
- `EditProfileView.swift`
- `SettingsView.swift`
- `Post.swift`
- `UserProfile.swift`
- `AuthViewModel.swift`
- `GoogleService-Info.plist`

## React Native mapping

| iOS / Swift concept | React Native file |
|---|---|
| `LaunchGate`, auth listener | `App.tsx` |
| `WelcomeView` | `src/screens/WelcomeScreen.tsx` |
| `LoginView` | `src/screens/LoginScreen.tsx` |
| `SignUpView` | `src/screens/SignUpScreen.tsx` |
| `HomeView` selected tab container | `App.tsx` `MainApp` |
| `CubeTabView` | `src/components/PoplurCube.tsx` |
| `FeedView`, `FeedVideoView` | `src/screens/FeedScreen.tsx` |
| `MapView`, `MediaPickerView` map flow | `src/screens/MapScreen.tsx` |
| `CameraKitController`, `CameraView` | `src/screens/CameraScreen.tsx` |
| `ProfileView`, `EditProfileView` | `src/screens/ProfileScreen.tsx` |
| `SettingsView` | `src/screens/SettingsScreen.tsx` |
| `Post.swift` | `src/types/models.ts` |
| Firebase helpers | `src/services/*.ts` |

## Feature coverage

Implemented:

- Email/password auth
- User profile creation and editing
- Firebase posts model with `userID`, `mediaURL`, `mediaType`, `viewCount`, `radius`, `latitude`, `longitude`, `createdAt`
- Feed render for images/videos
- Firestore view-count/radius increment on post tap
- Google/Apple map screen through `react-native-maps`
- Radius circles matching iOS 5 km starting radius idea
- Tap-to-select coordinate and upload media to that coordinate
- Camera capture, video recording, torch, camera flip, media library picker
- Profile post grid and stats
- Bottom cube-style tab controller with Record / Feed / Profile / Map order and Feed default

Partially implemented / requires native follow-up:

- The SceneKit cube is approximated with React Native Animated, not true SceneKit.
- AR filters, CoreML face detection, Metal filters, USDZ viewer, and advanced SpriteKit/SceneKit visuals were not ported.
- 9:16 video crop/export was not implemented; use a native module, FFmpeg kit, or VisionCamera pipeline later.
- Snap/Bitmoji placeholder managers were not ported.
- Google Maps API keys must be configured locally for production builds.

## Why this structure

The goal is a runnable cross-platform performance test, not a full low-level native clone. This version lets you compare:

- Camera launch speed
- Video recording stability
- Feed scroll performance
- Map marker/radius rendering
- Firebase upload speed
- Overall UI smoothness on Android and iOS

