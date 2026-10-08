import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { type AddressInfo, type Server, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PrintError, printNetwork, printVirtual, spoolerMessage } from './transports.js';

let server: Server | null = null;

/** A fake network printer: records what it receives, answers status queries with `status`. */
async function fakePrinter(paperStatus: number | null) {
  const received: Buffer[] = [];
  server = createServer((socket) => {
    socket.on('data', (data) => {
      if (data[0] === 0x10 && data[1] === 0x04) {
        if (paperStatus !== null) socket.write(Buffer.from([data[2] === 4 ? paperStatus : 0x12]));
        if (data.length > 3) received.push(data.subarray(3));
        return;
      }
      received.push(data);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { address: `127.0.0.1:${port}`, received };
}

afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
  server = null;
});

describe('network printer (port 9100)', () => {
  it('sends the bytes after checking the paper', async () => {
    const printer = await fakePrinter(0x12);
    const status = await printNetwork(printer.address, new Uint8Array([0x1b, 0x40, 0x41]));
    expect(status).toBe('OK');
    await new Promise((r) => setTimeout(r, 50));
    expect(Buffer.concat(printer.received)).toEqual(Buffer.from([0x1b, 0x40, 0x41]));
  });

  it('prints on printers that do not answer status', async () => {
    const printer = await fakePrinter(null);
    expect(await printNetwork(printer.address, new Uint8Array([0x41]))).toBe('OK');
  });

  it('keeps the job when there is no paper', async () => {
    const printer = await fakePrinter(0x72);
    const error = await printNetwork(printer.address, new Uint8Array([0x41])).catch((e) => e);
    expect(error).toBeInstanceOf(PrintError);
    expect(error).toMatchObject({ status: 'PAPER_OUT', message: 'Impressora sem papel' });
    expect(printer.received).toEqual([]);
  });

  it('explains an unreachable printer', async () => {
    const printer = await fakePrinter(0x12);
    await new Promise((resolve) => server!.close(resolve));
    server = null;
    const error = await printNetwork(printer.address, new Uint8Array([0x41])).catch((e) => e);
    expect(error).toMatchObject({ status: 'OFFLINE' });
    expect(error.message).toMatch(/recusou a conexão/);
    await expect(printNetwork('não é ip', new Uint8Array([1]))).rejects.toMatchObject({
      status: 'ERROR',
    });
  });
});

describe('Windows spooler errors', () => {
  it('turns Win32 codes into plain words', () => {
    expect(spoolerMessage('Exception: OPEN 1801')).toEqual({
      message: 'Impressora não encontrada no Windows (confira o nome)',
      status: 'OFFLINE',
    });
    expect(spoolerMessage('OPEN 67').status).toBe('OFFLINE');
    expect(spoolerMessage('WRITE 5').message).toMatch(/permissão/);
    expect(spoolerMessage('algo').message).toBe('Erro do Windows ao imprimir');
  });
});

describe('virtual printer', () => {
  it('writes the text preview with the copies, and the raw bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-virtual-'));
    const { file } = await printVirtual(
      dir,
      {
        id: 'job1',
        kind: 'KITCHEN_TICKET',
        copies: 2,
        printer: {
          id: 'p1',
          name: 'Cozinha 1',
          connection: 'VIRTUAL',
          address: '',
          profileId: 'generic-cp860',
          paperWidth: 58,
          withoutAccents: false,
        },
        document: { title: 't', lines: [{ kind: 'text', text: 'Pão de queijo' }] },
      },
      new Uint8Array([1, 2]),
    );
    const text = await readFile(file, 'utf8');
    expect(text.match(/Pão de queijo/g)).toHaveLength(2);
    expect((await readdir(dir)).sort()).toEqual([
      expect.stringMatching(/Cozinha_1_KITCHEN_TICKET_job1\.bin$/),
      expect.stringMatching(/Cozinha_1_KITCHEN_TICKET_job1\.txt$/),
    ]);
  });
});

describe.runIf(process.platform === 'win32')('Windows spooler (RAW)', () => {
  it('lists installed printers and explains a printer that does not exist', async () => {
    const { listWindowsPrinters, printSpooler } = await import('./transports.js');
    expect(Array.isArray(await listWindowsPrinters())).toBe(true);
    await expect(
      printSpooler('Impressora Que Nao Existe 123', new Uint8Array([0x41]), 'Teste'),
    ).rejects.toMatchObject({
      status: 'OFFLINE',
      message: 'Impressora não encontrada no Windows (confira o nome)',
    });
  }, 60_000);
});
