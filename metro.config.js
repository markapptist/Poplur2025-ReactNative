const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The approved pre-login screens are bundled HTML, not native remakes. Metro
// needs to treat the HTML and the GL/audio/video files they reference as
// static assets so Asset.fromModule() can resolve them on both platforms.
for (const extension of ['html', 'glb', 'wasm', 'wav', 'zip']) {
  if (!config.resolver.assetExts.includes(extension)) {
    config.resolver.assetExts.push(extension);
  }
}

// Several native-only modules have no web build, so importing the app's screens
// breaks web rendering. For the WEB platform only, alias each to a local shim so
// the app renders in a browser. Native (iOS/Android) keeps the real packages.
const webAliases = {
  'react-native-webview': path.resolve(__dirname, 'src/shims/WebViewWeb.tsx'),
  'react-native-maps': path.resolve(__dirname, 'src/shims/react-native-maps.web.tsx'),
  '@dr.pogodin/react-native-static-server': path.resolve(__dirname, 'src/shims/react-native-static-server.web.ts'),
  'react-native-zip-archive': path.resolve(__dirname, 'src/shims/react-native-zip-archive.web.ts')
};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && webAliases[moduleName]) {
    return { type: 'sourceFile', filePath: webAliases[moduleName] };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
