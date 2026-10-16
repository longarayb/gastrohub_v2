// Config plugin (D050): the release APK is signed with the app's own key, never the debug key
// of the generated project. The key comes from Gradle properties given by scripts/build-apk.mjs
// (ORG_GRADLE_PROJECT_COURIER_*), so nothing about it is written in android/. Without them a
// release build fails instead of falling back to the debug key.
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_SIGNING = `
        release {
            if (!project.hasProperty('COURIER_KEYSTORE')) {
                throw new GradleException('Chave de assinatura ausente: use pnpm --filter @app/courier apk')
            }
            storeFile file(project.property('COURIER_KEYSTORE'))
            storePassword project.property('COURIER_KEYSTORE_PASSWORD')
            keyAlias project.property('COURIER_KEY_ALIAS')
            keyPassword project.property('COURIER_KEY_PASSWORD')
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let gradle = mod.modResults.contents;
    if (!gradle.includes("project.property('COURIER_KEYSTORE')")) {
      // Adds the release signing config next to the debug one.
      gradle = gradle.replace(/signingConfigs\s*\{/, (m) => `${m}${RELEASE_SIGNING}`);
      // The release build type uses it (the template points it to the debug key).
      gradle = gradle.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
        '$1signingConfig signingConfigs.release',
      );
    }
    if (!/release\s*\{[\s\S]*?signingConfig signingConfigs\.release/.test(gradle)) {
      throw new Error('with-release-signing: não encontrei o buildType release no build.gradle');
    }
    mod.modResults.contents = gradle;
    return mod;
  });
};
