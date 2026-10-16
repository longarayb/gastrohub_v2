import { BRAND, POSITION_MAX_ACCURACY_METERS, POSITION_SEND_SECONDS } from '@app/shared';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { flush, queuePositions } from './courier';
import { storage } from './storage';

/**
 * Location in the background (D050): an Android foreground service with the fixed notification
 * "Compartilhando localização", only during the route. Started by the courier ("Iniciar rota"),
 * stopped by the courier or by itself when the server says no stop is left. The task is defined
 * at the top of the app (index.ts): Android may run it without the screens.
 */
export const LOCATION_TASK = 'courier-location';

let lastFlush = 0;

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await queuePositions(
      data.locations
        .filter((l) => (l.coords.accuracy ?? 0) <= POSITION_MAX_ACCURACY_METERS)
        .map((l) => ({
          latitude: l.coords.latitude,
          longitude: l.coords.longitude,
          accuracyMeters: l.coords.accuracy ?? null,
          speedMps: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
          heading: l.coords.heading != null && l.coords.heading >= 0 ? l.coords.heading : null,
          recordedAt: new Date(l.timestamp).toISOString(),
        })),
    );
    if (Date.now() - lastFlush < POSITION_SEND_SECONDS * 1000) return;
    lastFlush = Date.now();
    const outcome = await flush().catch(() => null);
    // Last stop concluded, or the route was closed at the store: sharing stops by itself.
    if (outcome && (outcome.pendingStops === 0 || outcome.noRun)) await stopSharing();
  },
);

export async function isSharing(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(LOCATION_TASK).then((registered) =>
    registered ? Location.hasStartedLocationUpdatesAsync(LOCATION_TASK) : false,
  );
}

export type PermissionStep = 'foreground' | 'background' | 'granted';

/** Which permission is missing (the screen explains before asking). */
export async function missingPermission(): Promise<PermissionStep> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) return 'foreground';
  const background = await Location.getBackgroundPermissionsAsync();
  return background.granted ? 'granted' : 'background';
}

/** Asks one step (Android 11+ opens the settings page for "Permitir o tempo todo"). */
export async function askPermission(step: PermissionStep): Promise<boolean> {
  if (step === 'foreground') return (await Location.requestForegroundPermissionsAsync()).granted;
  if (step === 'background') return (await Location.requestBackgroundPermissionsAsync()).granted;
  return true;
}

export async function startSharing(): Promise<void> {
  const session = await storage.getSession();
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: POSITION_SEND_SECONDS * 1000,
    distanceInterval: 15,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Compartilhando localização',
      notificationBody: `${session?.storeName || 'A loja'} vê sua posição até o fim da rota.`,
      notificationColor: BRAND.colors.primaryHex,
      killServiceOnDestroy: false,
    },
  });
  await storage.setSharing(true);
}

export async function stopSharing(): Promise<void> {
  if (await isSharing()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await storage.setSharing(false);
  // Whatever is left goes out now (or with the next connection).
  await flush().catch(() => null);
}
