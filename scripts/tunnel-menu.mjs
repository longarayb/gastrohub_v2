// `pnpm tunnel:menu`: temporary public HTTPS address for the digital menu, ONLY to test the
// link preview in WhatsApp (it needs to fetch the page from the internet). Uses a Cloudflare
// quick tunnel (no account). It exposes the development environment: keep it open only for the
// test; it closes by itself after 30 minutes (`--minutes N` to change, Ctrl+C to close now).
import { spawn, spawnSync } from 'node:child_process';
import { fail, log } from './lib.mjs';

const arg = process.argv.indexOf('--minutes');
const minutes = Math.min(Math.max(Number(process.argv[arg + 1]) || 30, 1), 120);

const check = spawnSync('cloudflared', ['--version'], { shell: true, encoding: 'utf8' });
if (check.status !== 0) {
  fail(
    'cloudflared não está instalado. Instale (uma vez) no PowerShell:\n' +
      '    winget install --id Cloudflare.cloudflared\n' +
      '  e abra um terminal novo.',
  );
}

const health = await fetch('http://localhost:3001/').catch(() => null);
if (!health?.ok) fail('O cardápio não está no ar. Rode antes: pnpm start:lite --menu');

console.log(`
  ⚠  ATENÇÃO: o túnel deixa o cardápio de DESENVOLVIMENTO acessível por qualquer pessoa na
     internet enquanto estiver aberto. Use só para testar a prévia do link e feche logo depois.
     Ele se encerra sozinho em ${minutes} minuto(s). Nunca use com dados reais.
`);

// No shell: killing a shell on Windows would leave cloudflared (and the tunnel) running.
const tunnel = spawn('cloudflared', [
  'tunnel',
  '--no-autoupdate',
  '--url',
  'http://localhost:3001',
]);
let printed = false;
const onOutput = (chunk) => {
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk))?.[0];
  if (url && !printed) {
    printed = true;
    log(`Link temporário do cardápio: ${url}/demo`);
    console.log(`
  Para testar a prévia: envie o link acima numa conversa do WhatsApp (por exemplo, para você
  mesmo) e espere a prévia aparecer. Ela mostra o nome, a descrição e a imagem do restaurante.
  O WhatsApp guarda a prévia em cache: para ver uma mudança, gere um link novo (rode de novo).
  Pelo túnel a página abre, mas pedidos e fotos usam a API local: para testar pedidos no
  celular, use a rede local (pnpm start:lite --menu --lan e pnpm lan:links).
`);
  }
};
tunnel.stdout.on('data', onOutput);
tunnel.stderr.on('data', onOutput);

const stop = (reason) => {
  log(reason);
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(tunnel.pid), '/T', '/F']);
  } else {
    tunnel.kill('SIGINT');
  }
  setTimeout(() => process.exit(0), 1500).unref();
};
const timer = setTimeout(
  () => stop(`Tempo esgotado (${minutes} min): túnel encerrado.`),
  minutes * 60_000,
);
process.on('SIGINT', () => stop('Túnel encerrado.'));
process.on('SIGTERM', () => stop('Túnel encerrado.'));
tunnel.on('exit', () => {
  clearTimeout(timer);
  process.exit(0);
});
