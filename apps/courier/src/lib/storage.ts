import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { type QueueState, emptyQueue } from './queue';

/**
 * What the app keeps on the phone (D050). Tokens in the encrypted store (Android Keystore); the
 * rest in plain storage (no secrets: server address, offline queue, preferences). The background
 * location task reads the same values (it runs without the screens).
 */
const KEYS = {
  server: 'server-url',
  queue: 'offline-queue',
  session: 'session-info',
  sharing: 'sharing-on',
} as const;
const SECURE = { access: 'access-token', refresh: 'refresh-token' } as const;

export interface SessionInfo {
  userName: string;
  storeName: string;
}

export const storage = {
  getServer: () => AsyncStorage.getItem(KEYS.server),
  setServer: (url: string) => AsyncStorage.setItem(KEYS.server, url),

  async getQueue(): Promise<QueueState> {
    const raw = await AsyncStorage.getItem(KEYS.queue);
    if (!raw) return emptyQueue();
    try {
      return { ...emptyQueue(), ...(JSON.parse(raw) as QueueState) };
    } catch {
      return emptyQueue();
    }
  },
  setQueue: (state: QueueState) => AsyncStorage.setItem(KEYS.queue, JSON.stringify(state)),

  async getSession(): Promise<SessionInfo | null> {
    const raw = await AsyncStorage.getItem(KEYS.session);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  },
  setSession: (info: SessionInfo) => AsyncStorage.setItem(KEYS.session, JSON.stringify(info)),

  /** The courier started sharing for the current route (the task resumes after a restart). */
  getSharing: async () => (await AsyncStorage.getItem(KEYS.sharing)) === '1',
  setSharing: (on: boolean) =>
    on ? AsyncStorage.setItem(KEYS.sharing, '1') : AsyncStorage.removeItem(KEYS.sharing),

  getAccess: () => SecureStore.getItemAsync(SECURE.access),
  getRefresh: () => SecureStore.getItemAsync(SECURE.refresh),
  async setTokens(access: string, refresh: string): Promise<void> {
    await SecureStore.setItemAsync(SECURE.access, access);
    await SecureStore.setItemAsync(SECURE.refresh, refresh);
  },
  async clearSession(): Promise<void> {
    await SecureStore.deleteItemAsync(SECURE.access);
    await SecureStore.deleteItemAsync(SECURE.refresh);
    await AsyncStorage.multiRemove([KEYS.session, KEYS.sharing, KEYS.queue]);
  },
};
