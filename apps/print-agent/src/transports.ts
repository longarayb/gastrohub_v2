import { mkdir, rm, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentPrinterDto,
  type PrintDocument,
  type PrinterStatus,
  isOffline,
  isPaperOut,
  parseNetworkAddress,
  renderText,
} from '@app/shared';
import { runPowerShell } from './powershell.js';

/** A print that did not happen, with what the panel should show about the printer. */
export class PrintError extends Error {
  constructor(
    message: string,
    readonly status: PrinterStatus,
  ) {
    super(message);
  }
}

const NETWORK_ERRORS: Record<string, string> = {
  ECONNREFUSED: 'A impressora recusou a conexão (confira o IP e a porta)',
  ETIMEDOUT: 'Impressora não respondeu: desligada ou fora da rede',
  EHOSTUNREACH: 'Impressora fora da rede (confira o cabo ou o Wi-Fi)',
  ENETUNREACH: 'Este computador está sem rede',
  ECONNRESET: 'A impressora fechou a conexão no meio da impressão',
};

/** Reads one status byte (`DLE EOT n`); null when the printer does not answer status. */
function readStatus(socket: Socket, n: 1 | 4, waitMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const done = (value: number | null) => {
      clearTimeout(timer);
      socket.off('data', onData);
      resolve(value);
    };
    const onData = (data: Buffer) => done(data[0] ?? null);
    const timer = setTimeout(() => done(null), waitMs);
    socket.on('data', onData);
    socket.write(Buffer.from([0x10, 0x04, n]));
  });
}

/**
 * Network printer (raw TCP, port 9100). Before printing, asks the paper sensor (`DLE EOT 4`):
 * without paper the job is not sent, so it stays in the queue instead of being lost.
 */
export async function printNetwork(
  address: string,
  data: Uint8Array,
  options: { timeoutMs?: number; askStatus?: boolean } = {},
): Promise<PrinterStatus> {
  const target = parseNetworkAddress(address);
  if (!target) throw new PrintError('Endereço da impressora inválido', 'ERROR');
  const socket = new Socket();
  socket.setTimeout(options.timeoutMs ?? 10_000);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.once('timeout', () =>
        reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
      );
      socket.connect(target.port, target.host, () => resolve());
    });
    if (options.askStatus !== false) {
      const paper = await readStatus(socket, 4, 700);
      if (paper !== null && isPaperOut(paper))
        throw new PrintError('Impressora sem papel', 'PAPER_OUT');
      const printer = paper === null ? null : await readStatus(socket, 1, 500);
      if (printer !== null && isOffline(printer)) {
        throw new PrintError('Impressora com a tampa aberta ou em erro', 'ERROR');
      }
    }
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.end(Buffer.from(data), () => resolve());
    });
    return 'OK';
  } catch (error) {
    if (error instanceof PrintError) throw error;
    const code = (error as NodeJS.ErrnoException).code ?? '';
    throw new PrintError(
      NETWORK_ERRORS[code] ?? `Falha de rede (${code || 'desconhecida'})`,
      'OFFLINE',
    );
  } finally {
    socket.destroy();
  }
}

/** Sends raw bytes through the Windows spooler (USB printers and shares \\PC\Impressora). */
const RAW_PRINT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] data, int length, out int written);
  public static void Send(string printer, string document, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Exception("OPEN " + Marshal.GetLastWin32Error());
    try {
      DOCINFO info = new DOCINFO();
      info.pDocName = document;
      info.pDataType = "RAW";
      if (StartDocPrinter(handle, 1, info) == 0) throw new Exception("DOC " + Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(handle)) throw new Exception("PAGE " + Marshal.GetLastWin32Error());
        int written;
        if (!WritePrinter(handle, data, data.Length, out written) || written != data.Length)
          throw new Exception("WRITE " + Marshal.GetLastWin32Error());
        EndPagePrinter(handle);
      } finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
  }
}
"@
$printer = [Console]::In.ReadLine()
$file = [Console]::In.ReadLine()
$document = [Console]::In.ReadLine()
[RawPrint]::Send($printer, $document, [IO.File]::ReadAllBytes($file))
'OK'`;

/** Win32 errors of the spooler in plain words. */
export function spoolerMessage(raw: string): { message: string; status: PrinterStatus } {
  const code = Number(/(OPEN|DOC|PAGE|WRITE) (\d+)/.exec(raw)?.[2] ?? NaN);
  if (code === 1801 || code === 1722 || code === 2) {
    return { message: 'Impressora não encontrada no Windows (confira o nome)', status: 'OFFLINE' };
  }
  if (code === 5)
    return { message: 'Sem permissão para usar esta impressora no Windows', status: 'ERROR' };
  if (code === 53 || code === 67) {
    return {
      message: 'Computador da impressora compartilhada não encontrado na rede',
      status: 'OFFLINE',
    };
  }
  return {
    message: `Erro do Windows ao imprimir${Number.isFinite(code) ? ` (${code})` : ''}`,
    status: 'ERROR',
  };
}

export async function printSpooler(printerName: string, data: Uint8Array, documentName: string) {
  const file = join(tmpdir(), `print-agent-${process.pid}-${Date.now()}.bin`);
  await writeFile(file, data);
  try {
    // Line-based stdin: no line breaks inside the values.
    const clean = (s: string) => s.replace(/[\r\n]+/g, ' ');
    await runPowerShell(RAW_PRINT, `${clean(printerName)}\n${file}\n${clean(documentName)}\n`);
    return 'OK' as const;
  } catch (error) {
    const { message, status } = spoolerMessage(
      error instanceof Error ? error.message : String(error),
    );
    throw new PrintError(message, status);
  } finally {
    await rm(file, { force: true });
  }
}

/** Printers installed in Windows (to choose the USB printer in the panel). */
export async function listWindowsPrinters(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const out = await runPowerShell(
    `Get-CimInstance -ClassName Win32_Printer | Sort-Object Name | ForEach-Object { $_.Name }`,
  );
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
}

/** Virtual printer: the text preview (and the raw bytes) in a folder, for tests and demos. */
export async function printVirtual(
  dir: string,
  job: {
    id: string;
    kind: string;
    printer: AgentPrinterDto;
    copies: number;
    document: PrintDocument;
  },
  data: Uint8Array,
): Promise<{ status: PrinterStatus; file: string }> {
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = job.printer.name.replace(/[^\w-]+/g, '_');
  const base = join(dir, `${stamp}_${safe}_${job.kind}_${job.id}`);
  const text = renderText(job.document, job.printer.paperWidth).join('\n');
  const body = Array.from({ length: job.copies }, () => text).join(
    '\n\n- - - - - - - - - - - -\n\n',
  );
  await writeFile(`${base}.txt`, `${body}\n`, 'utf8');
  await writeFile(`${base}.bin`, data);
  return { status: 'OK', file: `${base}.txt` };
}
