import type { CourierAppReleaseDto, CourierAppStopDto, PushConfigDto } from '@app/shared';
import * as Application from 'expo-application';
import * as Battery from 'expo-battery';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { api, publicApi } from './api';
import { storage } from './storage';

/** Phone integrations of the courier app (D050): notices, battery, navigation and updates. */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type NoticeState = 'on' | 'denied' | 'server-off' | 'unavailable';

/**
 * "Rota nova" by Firebase: channel first (Android 13 only asks after one exists), then the
 * permission, then the device token to the server. `unavailable`: APK built without Firebase.
 */
export async function registerNotices(): Promise<NoticeState> {
  const config = await api<PushConfigDto>('/push/config');
  if (!config.fcm) return 'server-off';
  await Notifications.setNotificationChannelAsync('routes', {
    name: 'Rotas novas',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return 'denied';
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    await api('/push/subscriptions', {
      method: 'POST',
      body: { channel: 'FCM', token: String(token.data) },
    });
    return 'on';
  } catch {
    return 'unavailable';
  }
}

export async function batteryOptimized(): Promise<boolean> {
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return false;
  }
}

/** Android's own dialog "Permitir que o app seja executado em segundo plano?". */
export async function askBatteryExemption(): Promise<void> {
  await IntentLauncher.startActivityAsync('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', {
    data: `package:${Application.applicationId}`,
  });
}

/** The app's page in the phone settings (battery, notifications, permissions). */
export async function openAppSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', {
    data: `package:${Application.applicationId}`,
  });
}

/**
 * Navigation in Google Maps or Waze to the stop's point (or its address); Android's back
 * button and the "Compartilhando localização" notice bring the courier back to the app.
 */
export async function navigate(stop: CourierAppStopDto, app: 'google' | 'waze'): Promise<void> {
  const point = stop.location;
  if (point) {
    const url =
      app === 'google'
        ? `google.navigation:q=${point.latitude},${point.longitude}`
        : `https://waze.com/ul?ll=${point.latitude},${point.longitude}&navigate=yes`;
    if (await Linking.canOpenURL(url).catch(() => false)) {
      await Linking.openURL(url);
      return;
    }
  }
  if (stop.links) await Linking.openURL(app === 'google' ? stop.links.google : stop.links.waze);
}

export const call = (phone: string) => Linking.openURL(`tel:+55${phone}`);

/** A newer APK published on the server (the screen offers the download). */
export async function newerRelease(): Promise<CourierAppReleaseDto | null> {
  try {
    const latest = await publicApi<CourierAppReleaseDto>('/courier-app/latest');
    const installed = Number(Application.nativeBuildVersion ?? 0);
    return latest.versionCode > installed ? latest : null;
  } catch {
    return null;
  }
}

/** Opens the download in the browser; Android asks to install over the current version. */
export async function downloadRelease(release: CourierAppReleaseDto): Promise<void> {
  const server = await storage.getServer();
  if (server) await Linking.openURL(`${server}${release.downloadPath}`);
}

export const installedVersion = () =>
  `${Application.nativeApplicationVersion ?? '?'} (${Application.nativeBuildVersion ?? '?'})`;
