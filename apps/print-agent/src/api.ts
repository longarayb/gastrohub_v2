import type {
  AgentPrinterDto,
  PrintAgentSessionDto,
  PrintLeaseDto,
  PrinterStatus,
} from '@app/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The credential was revoked in the panel (or expired): the agent must be paired again. */
export class UnpairedError extends Error {
  constructor() {
    super('Este computador foi desvinculado no painel');
  }
}

type Fetch = typeof fetch;

/**
 * HTTP client of the agent endpoints. Keeps the short access token in memory and renews it
 * with the stored credential before it expires (or once after a 401).
 */
export class AgentApi {
  private access: { token: string; expiresAt: number } | null = null;

  constructor(
    readonly baseUrl: string,
    private readonly credential: () => Promise<string | null>,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  get origin(): string {
    return new URL(this.baseUrl).origin;
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    token: string | null,
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const message = (json as { message?: string } | null)?.message ?? `Erro ${res.status}`;
      throw new ApiError(res.status, message);
    }
    return json as T;
  }

  pair(input: {
    store: string;
    code: string;
    hostname: string;
    version: string;
  }): Promise<PrintAgentSessionDto> {
    return this.request('POST', '/print-agent/pair', input, null);
  }

  /** Exchanges the credential for an access token; UnpairedError when it no longer works. */
  async session(): Promise<PrintAgentSessionDto> {
    const token = await this.credential();
    if (!token) throw new UnpairedError();
    try {
      const session = await this.request<PrintAgentSessionDto>(
        'POST',
        '/print-agent/session',
        { token },
        null,
      );
      this.remember(session);
      return session;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw new UnpairedError();
      throw error;
    }
  }

  remember(session: { accessToken: string; expiresIn: number }): void {
    // Renew a minute before it expires.
    this.access = {
      token: session.accessToken,
      expiresAt: Date.now() + Math.max(session.expiresIn - 60, 10) * 1000,
    };
  }

  forget(): void {
    this.access = null;
  }

  async accessToken(): Promise<string> {
    if (!this.access || this.access.expiresAt < Date.now()) await this.session();
    return this.access!.token;
  }

  /** Authenticated call; renews the token once on 401. */
  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await this.request<T>(method, path, body, await this.accessToken());
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      this.access = null;
      return this.request<T>(method, path, body, await this.accessToken());
    }
  }

  heartbeat(body: {
    version: string;
    hostname: string;
    os: string;
    memoryMb: number;
    windowsPrinters: string[];
    printers: { id: string; status: PrinterStatus; detail?: string }[];
  }) {
    return this.call<{ printers: AgentPrinterDto[]; pendingJobs: number; serverTime: string }>(
      'POST',
      '/print-agent/heartbeat',
      body,
    );
  }

  lease(max = 10) {
    return this.call<PrintLeaseDto>('POST', '/print-agent/lease', { max });
  }

  ack(
    jobId: string,
    body: {
      attempt: number;
      result: 'PRINTED' | 'FAILED';
      error?: string;
      printerStatus?: PrinterStatus;
    },
  ) {
    return this.call<{ accepted: boolean }>('POST', `/print-agent/jobs/${jobId}/ack`, body);
  }
}
