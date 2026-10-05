/**
 * Static PIX QR Code ("BR Code", EMV® QRCPS-MPM as profiled by the Banco Central do Brasil,
 * Manual de Padrões para Iniciação do Pix). Pure: builds the copy-and-paste payload; the
 * panel renders it as a QR Code. Payment confirmation is manual (static QR, no webhook).
 */

import { isValidCNPJ, isValidCPF, onlyDigits } from '../utils/documents.js';
import { isValidPhone, normalizePhone } from '../utils/phone.js';

export const PIX_KEY_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM'] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];
export const PIX_KEY_TYPE_LABELS: Record<PixKeyType, string> = {
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  EMAIL: 'E-mail',
  PHONE: 'Celular',
  RANDOM: 'Chave aleatória',
};

/** BR Code limits (EMV fields 59, 60 and 62.05). */
export const PIX_MERCHANT_NAME_MAX = 25;
export const PIX_MERCHANT_CITY_MAX = 15;
export const PIX_TXID_MAX = 25;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RANDOM_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TXID_RE = /^[A-Za-z0-9]{1,25}$/;

/**
 * Canonical form of a PIX key as the DICT stores it: digits for CPF/CNPJ, lowercase e-mail,
 * phone as +55DDDNUMBER, lowercase random key (EVP). Returns null when the key is invalid.
 */
export function normalizePixKey(type: PixKeyType, raw: string): string | null {
  const value = raw.trim();
  switch (type) {
    case 'CPF':
      return isValidCPF(value) ? onlyDigits(value) : null;
    case 'CNPJ':
      return isValidCNPJ(value) ? onlyDigits(value) : null;
    case 'EMAIL': {
      const email = value.toLowerCase();
      return EMAIL_RE.test(email) && email.length <= 77 ? email : null;
    }
    case 'PHONE': {
      const digits = onlyDigits(value).replace(/^55(?=\d{10,11}$)/, '');
      const phone = normalizePhone(digits);
      return isValidPhone(phone) ? `+55${phone}` : null;
    }
    case 'RANDOM': {
      const key = value.toLowerCase();
      return RANDOM_KEY_RE.test(key) ? key : null;
    }
  }
}

/** Uppercase ASCII without accents, as recommended for fields 59 and 60. */
export function pixText(value: string, max: number): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, max)
    .trim();
}

/** The txid must be 1..25 alphanumeric characters (or "***" when absent). */
export function isValidPixTxid(txid: string): boolean {
  return TXID_RE.test(txid);
}

/** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as 4 uppercase hex digits. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** One EMV TLV field: id + 2-digit length + value. */
function field(id: string, value: string): string {
  const length = new TextEncoder().encode(value).length;
  if (length > 99) throw new RangeError(`Campo ${id} do PIX acima de 99 caracteres`);
  return `${id}${String(length).padStart(2, '0')}${value}`;
}

export interface PixBrCodeInput {
  /** Key already normalized (see `normalizePixKey`). */
  key: string;
  merchantName: string;
  merchantCity: string;
  /** Omit (or 0) to let the payer type the amount. */
  amountCents?: number | null;
  /** Up to 25 alphanumeric characters; omitted → "***". */
  txid?: string | null;
}

/** Builds the "PIX copia e cola" payload (also the QR Code content). */
export function buildPixBrCode(input: PixBrCodeInput): string {
  const name = pixText(input.merchantName, PIX_MERCHANT_NAME_MAX);
  const city = pixText(input.merchantCity, PIX_MERCHANT_CITY_MAX);
  if (!input.key) throw new RangeError('Chave PIX não informada');
  if (!name) throw new RangeError('Nome do recebedor do PIX não informado');
  if (!city) throw new RangeError('Cidade do recebedor do PIX não informada');
  const txid = input.txid ?? '***';
  if (txid !== '***' && !isValidPixTxid(txid)) {
    throw new RangeError('Identificador do PIX (txid) deve ter até 25 letras ou números');
  }
  const amount = input.amountCents ?? 0;
  if (!Number.isInteger(amount) || amount < 0) throw new RangeError('Valor do PIX inválido');

  const payload =
    field('00', '01') +
    field('26', field('00', 'br.gov.bcb.pix') + field('01', input.key)) +
    field('52', '0000') +
    field('53', '986') +
    (amount > 0 ? field('54', (amount / 100).toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', name) +
    field('60', city) +
    field('62', field('05', txid)) +
    '6304';
  return payload + crc16(payload);
}
