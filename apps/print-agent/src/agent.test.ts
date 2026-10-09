import { mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LeasedPrintJobDto } from '@app/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrintAgent, type Transports } from './agent.js';
import { AgentApi, UnpairedError } from './api.js';
import type { CredentialStore } from './credential.js';
import { startLocalPage } from './local-page.js';
import { Logger } from './log.js';
import { PrintError } from './transports.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

class MemoryCredential implements CredentialStore {
  constructor(public token: string | null = null) {}
  load = async () => this.token;
  save = async (token: string) => {
    this.token = token;
  };
  clear = async () => {
    this.token = null;
  };
}

const printer = {
  id: 'p1',
  name: 'Cozinha',
  connection: 'NETWORK' as const,
  address: '192.168.0.50',
  profileId: 'elgin-i9',
  paperWidth: 80 as const,
  withoutAccents: false,
};
const leased = (id: string, attempt = 1): LeasedPrintJobDto => ({
  id,
  attempt,
  kind: 'KITCHEN_TICKET',
  printer,
  copies: 1,
  document: { title: `Comanda ${id}`, lines: [{ kind: 'text', text: 'X-Burguer' }] },
});

describe('API client', () => {
  it('renews the access token once after a 401 and reports a revoked credential', async () => {
    const calls: string[] = [];
    let sessions = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).replace('http://api.test/api', '');
      calls.push(`${path} ${(init?.headers as Record<string, string>).authorization ?? ''}`);
      if (path === '/print-agent/session') {
        sessions++;
        return sessions <= 2
          ? json(200, { accessToken: `a${sessions}`, expiresIn: 900 })
          : json(401, { message: 'x' });
      }
      return init && (init.headers as Record<string, string>).authorization === 'Bearer a1'
        ? json(401, { message: 'expirado' })
        : json(200, { jobs: [], printers: [] });
    });
    const api = new AgentApi('http://api.test/api', async () => 'cred', fetchImpl as typeof fetch);
    await expect(api.lease()).resolves.toEqual({ jobs: [], printers: [] });
    expect(calls).toEqual([
      '/print-agent/session ',
      '/print-agent/lease Bearer a1',
      '/print-agent/session ',
      '/print-agent/lease Bearer a2',
    ]);
    api.forget();
    await expect(api.lease()).rejects.toBeInstanceOf(UnpairedError);
  });
});

describe('agent loop', () => {
  let page: Server | null = null;
  afterEach(() => {
    page?.close();
    page = null;
  });

  async function setup(jobs: LeasedPrintJobDto[], send: Transports['network']) {
    const acks: { id: string; body: Record<string, unknown> }[] = [];
    let served = false;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).replace('http://api.test/api', '');
      if (path === '/print-agent/session') {
        return json(200, {
          accessToken: 'a',
          expiresIn: 900,
          agent: { id: 'ag', name: 'PC do caixa' },
          store: { id: 's', name: 'Cantina', slug: 'cantina' },
          printers: [printer],
        });
      }
      if (path === '/print-agent/lease') {
        const body = { jobs: served ? [] : jobs, printers: [printer] };
        served = true;
        return json(200, body);
      }
      const ack = /\/print-agent\/jobs\/(\w+)\/ack/.exec(path);
      if (ack) {
        acks.push({ id: ack[1]!, body: JSON.parse(String(init?.body)) });
        return json(200, { accepted: true });
      }
      return json(404, {});
    });
    const dataDir = await mkdtemp(join(tmpdir(), 'agent-'));
    const agent = new PrintAgent(
      { apiUrl: 'http://api.test/api', dataDir, port: 0, virtual: false },
      new MemoryCredential('cred'),
      new Logger(null),
      {
        network: send,
        spooler: vi.fn(),
        virtual: vi.fn(),
        windowsPrinters: async () => [],
      },
      fetchImpl as typeof fetch,
    );
    return { agent, acks };
  }

  it('prints each leased job and acknowledges it with the attempt', async () => {
    const sent: number[] = [];
    const { agent, acks } = await setup([leased('j1'), leased('j2', 3)], async (_a, data) => {
      sent.push(data.length);
      return 'OK';
    });
    await agent.lease();
    expect(sent).toHaveLength(2);
    expect(acks).toEqual([
      { id: 'j1', body: { attempt: 1, result: 'PRINTED', printerStatus: 'OK' } },
      { id: 'j2', body: { attempt: 3, result: 'PRINTED', printerStatus: 'OK' } },
    ]);
    expect(agent.recent.map((r) => r.title)).toEqual(['Comanda j2', 'Comanda j1']);
    agent.stop();
  });

  it('reports a failure with the printer status (the server retries later)', async () => {
    const { agent, acks } = await setup([leased('j1')], async () => {
      throw new PrintError('Impressora sem papel', 'PAPER_OUT');
    });
    await agent.lease();
    expect(acks[0]!.body).toEqual({
      attempt: 1,
      result: 'FAILED',
      error: 'Impressora sem papel',
      printerStatus: 'PAPER_OUT',
    });
    expect(agent.statuses.get('p1')).toEqual({
      status: 'PAPER_OUT',
      detail: 'Impressora sem papel',
    });
    agent.stop();
  });

  it('local page answers only to its own host and with the form token', async () => {
    const { agent } = await setup([], async () => 'OK');
    agent.state = 'UNPAIRED';
    page = await startLocalPage(agent, 0);
    const port = (page.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain('Código de vínculo');
    expect(html).not.toContain('cred');
    // Its own CSP blocks inline JavaScript: the page must not depend on it.
    expect(html).not.toMatch(/\son[a-z]+=/);

    // DNS rebinding: another host name pointing to 127.0.0.1 is refused.
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      request(
        { host: '127.0.0.1', port, path: '/', headers: { host: `evil.test:${port}` } },
        (res) => resolve(res.statusCode ?? 0),
      ).end();
    });
    expect(status).toBe(403);
    // Another site posting the form does not know the token.
    const post = await fetch(`${base}/unpair`, {
      method: 'POST',
      body: new URLSearchParams({ csrf: 'x' }),
      redirect: 'manual',
    });
    expect(post.status).toBe(403);

    // Paired: unpairing asks for confirmation on its own page (no inline JavaScript).
    agent.state = 'ONLINE';
    const paired = await (await fetch(`${base}/`)).text();
    expect(paired).toContain('href="/?confirmar=desvincular"');
    expect(paired).not.toContain('action="/unpair"');
    const confirm = await (await fetch(`${base}/?confirmar=desvincular`)).text();
    expect(confirm).toContain('Sim, desvincular');
    expect(confirm).toContain('action="/unpair"');
    for (const html of [paired, confirm]) expect(html).not.toMatch(/son[a-z]+=/);
    agent.stop();
  });
});
