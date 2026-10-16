import { distanceMeters } from '../domain/delivery.js';

/**
 * Courier location sharing (D049). Pure rules used by the API, the panel and the courier's
 * phone; no Zod here (this file runs in the browser bundle of /entregas).
 */

/** Version of the text below: changing the text means a new version (the courier accepts again). */
export const TRACKING_CONSENT_VERSION = '2026-10-16';

/** What the courier reads before sharing the location (LGPD: what, when, why, who, how long). */
export const TRACKING_CONSENT_TEXT = [
  'O que é enviado: sua posição (latitude e longitude), a precisão, a velocidade e a direção do celular.',
  'Quando: só enquanto você tiver uma saída aberta e a página de entregas estiver aberta com a localização ligada. Fora da rota, nada é enviado.',
  'Para quê: mostrar no mapa do despacho onde você está e calcular a chegada prevista de cada entrega.',
  'Quem vê: só o caixa, o gerente e o dono da loja. O cliente não vê sua posição.',
  'Por quanto tempo: as posições são apagadas depois de 7 dias; fica só o resumo da saída (distância e tempos).',
  'Você pode parar de compartilhar a qualquer momento no botão "Parar localização".',
] as const;

/** The phone sends at most one position every this many seconds. */
export const POSITION_SEND_SECONDS = 10;
/** A position is stored when the courier moved this much or this time passed since the last one. */
export const POSITION_STORE_METERS = 30;
export const POSITION_STORE_SECONDS = 15;
/** Positions with a worse precision than this are ignored (indoor, cell tower fixes). */
export const POSITION_MAX_ACCURACY_METERS = 200;
/** Without a new position for this long, the dispatch shows "sem sinal". */
export const SIGNAL_STALE_SECONDS = 120;
/** Arrivals are recalculated from the current position at most this often (routing quota). */
export const ETA_REFRESH_SECONDS = 180;

export interface PositionSample {
  latitude: number;
  longitude: number;
  recordedAt: string | Date;
  accuracyMeters?: number | null;
}

const timeOf = (p: PositionSample) => new Date(p.recordedAt).getTime();

/** Stored when there is no previous one, or it moved enough, or enough time passed. */
export function shouldStorePosition(last: PositionSample | null, next: PositionSample): boolean {
  if (!last) return true;
  if (timeOf(next) <= timeOf(last)) return false;
  if (timeOf(next) - timeOf(last) >= POSITION_STORE_SECONDS * 1000) return true;
  return distanceMeters(last, next) >= POSITION_STORE_METERS;
}

export function isUsablePosition(p: PositionSample): boolean {
  return p.accuracyMeters == null || p.accuracyMeters <= POSITION_MAX_ACCURACY_METERS;
}

/** Minutes without signal, or null while the signal is fresh. */
export function signalLostMinutes(recordedAt: string | Date | null, now: Date): number | null {
  if (!recordedAt) return null;
  const seconds = (now.getTime() - new Date(recordedAt).getTime()) / 1000;
  return seconds >= SIGNAL_STALE_SECONDS ? Math.floor(seconds / 60) : null;
}
