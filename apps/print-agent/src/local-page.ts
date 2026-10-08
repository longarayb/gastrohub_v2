import { randomBytes } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BRAND, PRINTER_CONNECTION_LABELS, PRINTER_STATUS_LABELS } from '@app/shared';
import type { PrintAgent } from './agent.js';
import { memoryMb } from './agent.js';
import { AGENT_VERSION, DEFAULT_API_URL } from './config.js';
import { errorText } from './log.js';

const escape = (s: string | null | undefined) =>
  (s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const STATE_LABELS = {
  UNPAIRED: 'Não vinculado',
  CONNECTING: 'Conectando…',
  ONLINE: 'Conectado',
  OFFLINE: 'Sem conexão com o sistema',
} as const;

const time = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

function page(agent: PrintAgent, csrf: string, message: string | null): string {
  const paired = agent.state !== 'UNPAIRED';
  const printers = agent.printers
    .map((p) => {
      const s = agent.statuses.get(p.id);
      return `<li><b>${escape(p.name)}</b> · ${escape(PRINTER_CONNECTION_LABELS[p.connection])}${
        p.address ? ` (${escape(p.address)})` : ''
      } · ${p.paperWidth} mm — ${escape(PRINTER_STATUS_LABELS[s?.status ?? 'UNKNOWN'])}${
        s?.detail ? `: ${escape(s.detail)}` : ''
      }</li>`;
    })
    .join('');
  const recent = agent.recent
    .map(
      (r) =>
        `<li class="${r.ok ? '' : 'bad'}">${escape(time(r.at))} · ${escape(r.title)} · ${escape(r.printer)}${
          r.ok ? '' : ` — ${escape(r.error)}`
        }</li>`,
    )
    .join('');
  const body = paired
    ? `<p class="state ${agent.state.toLowerCase()}">${escape(STATE_LABELS[agent.state])}</p>
      <p>Unidade: <b>${escape(agent.storeName)}</b><br>Este computador: <b>${escape(agent.agentName)}</b></p>
      ${agent.lastError ? `<p class="bad">${escape(agent.lastError)}</p>` : ''}
      <h2>Impressoras</h2>
      ${printers ? `<ul>${printers}</ul>` : '<p>Nenhuma impressora cadastrada para este computador. Cadastre no painel, em Configurações › Impressão.</p>'}
      <h2>Últimas impressões</h2>
      ${recent ? `<ul>${recent}</ul>` : '<p>Nenhuma impressão desde que o agente iniciou.</p>'}
      <form method="post" action="/unpair" onsubmit="return confirm('Desvincular este computador? Ele para de imprimir até ser vinculado de novo.')">
        <input type="hidden" name="csrf" value="${csrf}">
        <button class="secondary">Desvincular este computador</button>
      </form>`
    : `${agent.lastError ? `<p class="bad">${escape(agent.lastError)}</p>` : ''}
      <p>No painel, abra <b>Configurações › Impressão</b>, clique em <b>Adicionar computador</b> e digite aqui os códigos mostrados.</p>
      <form method="post" action="/pair">
        <input type="hidden" name="csrf" value="${csrf}">
        <label>Endereço do sistema<input name="apiUrl" value="${escape(agent.apiUrl || DEFAULT_API_URL)}" required></label>
        <label>Código da unidade<input name="store" autocomplete="off" required placeholder="ex.: cantina-da-praca"></label>
        <label>Código de vínculo (6 números)<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></label>
        <button>Vincular</button>
      </form>`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Impressão · ${escape(BRAND.name)}</title>
${paired ? '<meta http-equiv="refresh" content="10">' : ''}
<style>
body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;color:#1f2328;background:#fff}
h1{font-size:1.4rem}h2{font-size:1.05rem;margin-top:1.5rem}
label{display:block;margin:.8rem 0;font-weight:600}input{display:block;width:100%;box-sizing:border-box;padding:.55rem;font-size:1rem;margin-top:.3rem;border:1px solid #8c959f;border-radius:6px}
button{padding:.6rem 1.2rem;font-size:1rem;border:0;border-radius:6px;background:${BRAND.colors.primaryHex};color:#fff;cursor:pointer}
button.secondary{background:#eaeef2;color:#1f2328;margin-top:1.5rem}
.state{font-weight:700}.online{color:#1a7f37}.offline,.bad{color:#cf222e}.connecting{color:#9a6700}
.msg{background:#ddf4ff;padding:.6rem;border-radius:6px}small{color:#59636e}
</style></head><body>
<h1>Impressão automática · ${escape(BRAND.name)}</h1>
${message ? `<p class="msg">${escape(message)}</p>` : ''}
${body}
<p><small>Versão ${escape(AGENT_VERSION)} · memória ${memoryMb()} MB · esta página só abre neste computador.</small></p>
</body></html>`;
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('Formulário grande demais');
  }
  return new URLSearchParams(raw);
}

/**
 * Local page for pairing and status (docs/DECISOES.md D035): only on 127.0.0.1, only with the
 * Host header of this page (blocks DNS rebinding) and a per-process form token (blocks other
 * sites posting to it).
 */
export function startLocalPage(agent: PrintAgent, port: number): Promise<Server> {
  const csrf = randomBytes(24).toString('base64url');
  let message: string | null = null;

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader(
      'content-security-policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    );
    // The real port (also when started with port 0 in tests).
    const listening = (server.address() as AddressInfo | null)?.port ?? port;
    const allowed = [`127.0.0.1:${listening}`, `localhost:${listening}`];
    if (!allowed.includes(req.headers.host ?? '')) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(page(agent, csrf, message));
      message = null;
      return;
    }
    if (req.method === 'GET' && url.pathname === '/status.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          state: agent.state,
          version: AGENT_VERSION,
          memoryMb: memoryMb(),
          printers: agent.printers.map((p) => ({ name: p.name, ...agent.statuses.get(p.id) })),
        }),
      );
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/pair' || url.pathname === '/unpair')) {
      const form = await readForm(req);
      if (form.get('csrf') !== csrf) {
        res.writeHead(403).end();
        return;
      }
      try {
        if (url.pathname === '/pair') {
          await agent.pair({
            apiUrl: form.get('apiUrl') ?? '',
            store: form.get('store') ?? '',
            code: form.get('code') ?? '',
          });
          message = 'Computador vinculado. As impressões já podem chegar.';
        } else {
          await agent.unpair();
          message = 'Computador desvinculado.';
        }
      } catch (error) {
        message = `Não foi possível: ${errorText(error)}`;
      }
      res.writeHead(303, { location: '/' }).end();
      return;
    }
    res.writeHead(404).end();
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
