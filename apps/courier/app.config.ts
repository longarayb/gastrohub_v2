import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { BRAND } from '@app/shared';

/**
 * Android courier app (D050). The name comes from the brand; the package id is neutral and must
 * never change once phones have the app (another id = another app, the old one stays installed).
 * Version: release.json (versionCode goes up by one on every APK).
 */
const release = JSON.parse(readFileSync(path.join(__dirname, 'release.json'), 'utf8')) as {
  versionCode: number;
  versionName: string;
};

/** google-services.json of the Firebase project: outside the repository (COURIER_GOOGLE_SERVICES). */
const googleServices = process.env.COURIER_GOOGLE_SERVICES;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `${BRAND.name} Entregas`,
  slug: 'courier',
  version: release.versionName,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: 'app.foodservice.entregas',
    versionCode: release.versionCode,
    adaptiveIcon: {
      backgroundColor: '#0b111c',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    ...(googleServices && existsSync(googleServices) && { googleServicesFile: googleServices }),
    permissions: [
      // Asks to be left out of battery optimization (sideloaded APK; the Play Store would need
      // a justification, ROADMAP).
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      'android.permission.POST_NOTIFICATIONS',
    ],
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },
  plugins: [
    'expo-secure-store',
    [
      'expo-location',
      {
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        locationAlwaysAndWhenInUsePermission:
          'Para a loja acompanhar sua rota e calcular a chegada das entregas.',
        locationWhenInUsePermission:
          'Para a loja acompanhar sua rota e calcular a chegada das entregas.',
      },
    ],
    ['expo-notifications', { color: BRAND.colors.primaryHex, defaultChannel: 'routes' }],
    [
      'expo-build-properties',
      {
        android: {
          // The home network server is http (LAN); the hosted one is https.
          usesCleartextTraffic: true,
          // Phones of the last years are all 64-bit ARM: a smaller APK and a lighter build.
          buildArchs: ['arm64-v8a'],
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
  ],
  extra: { versionCode: release.versionCode },
});
