import { hostname, release, totalmem } from 'node:os';
import {
  AGENT_HEARTBEAT_MS,
  type AgentPrinterDto,
  type LeasedPrintJobDto,
  type PaperWidth,
  type PrinterStatus,
  REALTIME_EVENTS,
  encodeEscPos,
  printerProfile,
} from '@app/shared';
import { type Socket, io } from 'socket.io-client';
import { AgentApi, ApiError, UnpairedError } from './api.js';
import {
  AGENT_VERSION,
  type AgentOptions,
  loadSettings,
  saveSettings,
  virtualDir,
} from './config.js';
import type { CredentialStore } from './credential.js';
import { type Logger, errorText } from './log.js';
import {
  PrintError,
  listWindowsPrinters,
  printNetwork,
  printSpooler,
  printVirtual,
} from './transports.js';

export type AgentState = 'UNPAIRED' | 'CONNECTING' | 'ONLINE' | 'OFFLINE';

export interface RecentPrint {
  at: string;
  title: string;
  printer: string;
  ok: boolean;
  error?: string;
}

/** Windows printers change rarely: listed every few minutes, not on every heartbeat. */
const WINDOWS_PRINTERS_EVERY_MS = 5 * 60_000;
const RECENT_LIMIT = 15;

export const memoryMb = () => Math.round((process.memoryUsage().rss / 1_048_576) * 10) / 10;

export interface Transports {
  network: typeof printNetwork;
  spooler: typeof printSpooler;
  virtual: typeof printVirtual;
  windowsPrinters: typeof listWindowsPrinters;
}

const DEFAULT_TRANSPORTS: Transports = {
  network: printNetwork,
  spooler: printSpooler,
  virtual: printVirtual,
  windowsPrinters: listWindowsPrinters,
};

/**
 * The agent (docs/DECISOES.md D035): connects with its credential, receives "new jobs" nudges
 * through the realtime channel (outbound connection only, nothing listens on the network),
 * sends a heartbeat every 30 s (which also catches nudges lost while reconnecting), leases the
 * jobs of its printers, prints and acknowledges each one.
 */
export class PrintAgent {
  state: AgentState = 'CONNECTING';
  storeName: string | null = null;
  agentName: string | null = null;
  lastError: string | null = null;
  lastContactAt: string | null = null;
  printers: AgentPrinterDto[] = [];
  readonly statuses = new Map<string, { status: PrinterStatus; detail?: string }>();
  readonly recent: RecentPrint[] = [];
  windowsPrinters: string[] = [];
  apiUrl: string;

  private api: AgentApi;
  private socket: Socket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private windowsPrintersAt = 0;
  private leasing = false;
  private leaseAgain = false;
  private stopped = false;

  constructor(
    private readonly options: AgentOptions,
    private readonly credential: CredentialStore,
    private readonly log: Logger,
    private readonly transports: Transports = DEFAULT_TRANSPORTS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiUrl = options.apiUrl;
    this.api = new AgentApi(this.apiUrl, () => this.credential.load(), this.fetchImpl);
  }

  async start(): Promise<void> {
    const saved = await loadSettings(this.options.dataDir);
    if (!this.options.apiUrl && saved.apiUrl) this.useApi(saved.apiUrl);
    this.storeName = saved.storeName ?? null;
    this.agentName = saved.agentName ?? null;
    if (!(await this.credential.load())) {
      this.state = 'UNPAIRED';
      this.log.info('Aguardando vínculo pela página local');
      return;
    }
    await this.connect();
  }

  private useApi(apiUrl: string): void {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.api = new AgentApi(this.apiUrl, () => this.credential.load(), this.fetchImpl);
  }

  /** Pairing from the local page: store code + 6-digit code from the panel. */
  async pair(input: { apiUrl: string; store: string; code: string }): Promise<void> {
    this.disconnect();
    this.useApi(input.apiUrl);
    const session = await this.api.pair({
      store: input.store.trim().toLowerCase(),
      code: input.code.trim(),
      hostname: hostname(),
      version: AGENT_VERSION,
    });
    if (!session.refreshToken) throw new Error('Resposta de vínculo sem credencial');
    await this.credential.save(session.refreshToken);
    this.storeName = session.store.name;
    this.agentName = session.agent.name;
    this.printers = session.printers;
    await saveSettings(this.options.dataDir, {
      apiUrl: this.apiUrl,
      storeSlug: session.store.slug,
      storeName: session.store.name,
      agentName: session.agent.name,
    });
    this.log.info('Computador vinculado', { store: session.store.slug, agent: session.agent.name });
    this.stopped = false;
    this.api.remember(session);
    await this.connect();
  }

  /** "Desvincular" on the local page: the credential is erased from this PC. */
  async unpair(): Promise<void> {
    this.disconnect();
    await this.credential.clear();
    this.api.forget();
    this.state = 'UNPAIRED';
    this.printers = [];
    this.log.info('Credencial apagada deste computador');
  }

  private async connect(): Promise<void> {
    this.stopped = false;
    this.state = 'CONNECTING';
    try {
      const session = await this.api.session();
      this.storeName = session.store.name;
      this.agentName = session.agent.name;
      this.printers = session.printers;
      this.lastError = null;
    } catch (error) {
      if (error instanceof UnpairedError) return this.revoked();
      this.offline(error);
    }
    this.openSocket();
    this.scheduleHeartbeat(0);
  }

  private openSocket(): void {
    this.socket?.disconnect();
    const socket = io(`${this.api.origin}/realtime`, {
      transports: ['websocket'],
      reconnectionDelayMax: 30_000,
      // A fresh token on every (re)connection attempt.
      auth: (cb) => {
        this.api
          .accessToken()
          .then((token) => cb({ token }))
          .catch(() => cb({}));
      },
    });
    socket.on('ready', () => {
      this.log.info('Canal de tempo real conectado');
      void this.lease();
    });
    socket.on(REALTIME_EVENTS.PRINT_JOBS, () => void this.lease());
    socket.on(REALTIME_EVENTS.DEVICE_REVOKED, () => void this.revoked());
    socket.on('disconnect', (reason) => {
      // The server drops the socket when the access token expires: reconnect with a new one.
      if (reason === 'io server disconnect' && !this.stopped) {
        setTimeout(() => socket.connect(), 1000);
      }
    });
    this.socket = socket;
  }

  private scheduleHeartbeat(delay = AGENT_HEARTBEAT_MS): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.stopped) return;
    this.heartbeatTimer = setTimeout(() => void this.heartbeat(), delay);
  }

  async heartbeat(): Promise<void> {
    try {
      if (Date.now() - this.windowsPrintersAt > WINDOWS_PRINTERS_EVERY_MS) {
        this.windowsPrintersAt = Date.now();
        this.windowsPrinters = await this.transports
          .windowsPrinters()
          .catch(() => this.windowsPrinters);
      }
      const res = await this.api.heartbeat({
        version: AGENT_VERSION,
        hostname: hostname(),
        os: `Windows ${release()} · ${Math.round(totalmem() / 1_073_741_824)} GB`,
        memoryMb: memoryMb(),
        windowsPrinters: this.windowsPrinters,
        printers: [...this.statuses].map(([id, s]) => ({ id, ...s })),
      });
      this.printers = res.printers;
      this.state = 'ONLINE';
      this.lastError = null;
      this.lastContactAt = new Date().toISOString();
      if (res.pendingJobs > 0) void this.lease();
    } catch (error) {
      if (error instanceof UnpairedError) return this.revoked();
      this.offline(error);
    } finally {
      this.scheduleHeartbeat();
    }
  }

  /** Leases and prints until the queue of this PC is empty (nudges while busy coalesce). */
  async lease(): Promise<void> {
    if (this.stopped || this.state === 'UNPAIRED') return;
    if (this.leasing) {
      this.leaseAgain = true;
      return;
    }
    this.leasing = true;
    try {
      do {
        this.leaseAgain = false;
        const { jobs, printers } = await this.api.lease(10);
        this.printers = printers;
        this.state = 'ONLINE';
        this.lastContactAt = new Date().toISOString();
        // Printers work in parallel; each one prints its jobs in order.
        const byPrinter = new Map<string, LeasedPrintJobDto[]>();
        for (const job of jobs)
          byPrinter.set(job.printer.id, [...(byPrinter.get(job.printer.id) ?? []), job]);
        await Promise.all(
          [...byPrinter.values()].map(async (list) => {
            for (const job of list) await this.print(job);
          }),
        );
        if (jobs.length === 10) this.leaseAgain = true;
      } while (this.leaseAgain && !this.stopped);
    } catch (error) {
      if (error instanceof UnpairedError) await this.revoked();
      else this.offline(error);
    } finally {
      this.leasing = false;
    }
  }

  private async send(job: LeasedPrintJobDto, data: Uint8Array): Promise<PrinterStatus> {
    const p = job.printer;
    if (this.options.virtual || p.connection === 'VIRTUAL') {
      const { file, status } = await this.transports.virtual(
        virtualDir(this.options.dataDir),
        job,
        data,
      );
      this.log.info('Impressão virtual', { file });
      return status;
    }
    if (p.connection === 'NETWORK') return this.transports.network(p.address, data);
    return this.transports.spooler(p.address, data, job.document.title);
  }

  async print(job: LeasedPrintJobDto): Promise<void> {
    const data = encodeEscPos(job.document, {
      profile: printerProfile(job.printer.profileId),
      width: job.printer.paperWidth as PaperWidth,
      withoutAccents: job.printer.withoutAccents,
      copies: job.copies,
    });
    let result:
      { ok: true; status: PrinterStatus } | { ok: false; status: PrinterStatus; error: string };
    try {
      result = { ok: true, status: await this.send(job, data) };
    } catch (error) {
      result = {
        ok: false,
        status: error instanceof PrintError ? error.status : 'ERROR',
        error: errorText(error),
      };
      this.log.warn('Falha ao imprimir', {
        job: job.id,
        printer: job.printer.name,
        error: result.error,
      });
    }
    this.statuses.set(job.printer.id, {
      status: result.status,
      ...(!result.ok && { detail: result.error }),
    });
    this.recent.unshift({
      at: new Date().toISOString(),
      title: job.document.title,
      printer: job.printer.name,
      ok: result.ok,
      ...(!result.ok && { error: result.error }),
    });
    this.recent.length = Math.min(this.recent.length, RECENT_LIMIT);
    await this.ack(job, result);
  }

  /** The answer is retried a few times; if it never arrives, the lease expires on the server. */
  private async ack(
    job: LeasedPrintJobDto,
    result: { ok: boolean; status: PrinterStatus; error?: string },
  ): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.api.ack(job.id, {
          attempt: job.attempt,
          result: result.ok ? 'PRINTED' : 'FAILED',
          ...(result.error && { error: result.error.slice(0, 300) }),
          printerStatus: result.status,
        });
        return;
      } catch (error) {
        if (error instanceof UnpairedError || (error instanceof ApiError && error.status < 500))
          return;
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }

  private offline(error: unknown): void {
    this.state = 'OFFLINE';
    const message = errorText(error);
    if (message !== this.lastError) this.log.warn('Sem contato com o sistema', { error: message });
    this.lastError = message;
  }

  private async revoked(): Promise<void> {
    this.log.warn('Este computador foi desvinculado no painel');
    await this.unpair();
    this.lastError = 'Este computador foi desvinculado no painel. Vincule de novo com um código.';
  }

  private disconnect(): void {
    this.stopped = true;
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.socket?.disconnect();
    this.socket = null;
  }

  stop(): void {
    this.disconnect();
  }
}
