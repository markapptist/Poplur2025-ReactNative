const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The approved pre-login screens are bundled HTML, not native remakes. Metro
// needs to treat the HTML and the GL/audio/video files they reference as
// static assets so Asset.fromModule() can resolve them on both platforms.
for (const extension of ['html', 'glb', 'wasm', 'wav', 'zip']) {
  if (!config.resolver.assetExts.includes(extension)) {
    config.resolver.assetExts.push(extension);
  }
}

module.exports = config;
