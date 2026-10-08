import { describe, expect, it } from 'vitest';
import { isSharedPrinterPath, parseNetworkAddress } from '../domain/printing.js';
import { printAckSchema, printerSchema } from './schemas.js';

describe('printer address', () => {
  it('parses IP and port (9100 by default)', () => {
    expect(parseNetworkAddress('192.168.0.50')).toEqual({ host: '192.168.0.50', port: 9100 });
    expect(parseNetworkAddress(' 10.0.0.7:9101 ')).toEqual({ host: '10.0.0.7', port: 9101 });
    expect(parseNetworkAddress('impressora-cozinha')).toEqual({
      host: 'impressora-cozinha',
      port: 9100,
    });
    expect(parseNetworkAddress('192.168.0.300')).toBeNull();
    expect(parseNetworkAddress('192.168.0.5:70000')).toBeNull();
    expect(parseNetworkAddress('http://x')).toBeNull();
  });

  it('checks the Windows share path', () => {
    expect(isSharedPrinterPath('\\\\PC-CAIXA\\Cozinha')).toBe(true);
    expect(isSharedPrinterPath('PC-CAIXA\\Cozinha')).toBe(false);
  });

  it('requires the address that matches the connection', () => {
    const base = { name: 'Cozinha', agentId: 'a1', profileId: 'generic-cp860', paperWidth: 80 };
    expect(printerSchema.safeParse({ ...base, connection: 'VIRTUAL' }).success).toBe(true);
    const net = printerSchema.safeParse({ ...base, connection: 'NETWORK', address: 'x y' });
    expect(net.error?.issues[0]?.path).toEqual(['address']);
    expect(
      printerSchema.safeParse({ ...base, connection: 'USB', address: 'ELGIN i9(USB)' }).success,
    ).toBe(true);
    expect(
      printerSchema.safeParse({ ...base, connection: 'VIRTUAL', paperWidth: 76 }).success,
    ).toBe(false);
    expect(
      printerSchema.safeParse({ ...base, connection: 'VIRTUAL', profileId: 'nope' }).success,
    ).toBe(false);
  });

  it('a failed print needs the error', () => {
    expect(printAckSchema.safeParse({ attempt: 1, result: 'FAILED' }).success).toBe(false);
    expect(printAckSchema.safeParse({ attempt: 1, result: 'PRINTED' }).success).toBe(true);
  });
});
