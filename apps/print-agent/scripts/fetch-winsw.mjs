// Downloads WinSW (Windows service wrapper of the print agent) from its official GitHub release
// into installer/vendor/ and checks the SHA-256 before keeping it. The binary is not versioned.
//
//   pnpm --filter @app/print-agent fetch:winsw
//
// WinSW is not Authenticode-signed, so the pinned hash is the trust anchor. It was checked
// against two independent sources: the official release download and Scoop's manifest
// (ScoopInstaller/Main, bucket/winsw.json). To upgrade WinSW, update VERSION and SHA256 after
// doing the same cross-check.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '2.12.0';
const SHA256 = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da';
const DOWNLOAD_URL = `https://github.com/winsw/winsw/releases/download/v${VERSION}/WinSW-x64.exe`;

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const vendor = join(root, 'installer', 'vendor');
const target = join(vendor, 'WinSW-x64.exe');
const log = (message) => process.stdout.write(`[print-agent] ${message}\n`);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

if (existsSync(target) && sha256(readFileSync(target)) === SHA256) {
  log(`WinSW ${VERSION} já está em installer/vendor (checksum conferido).`);
  process.exit(0);
}

mkdirSync(vendor, { recursive: true });
log(`baixando WinSW ${VERSION} de ${DOWNLOAD_URL}`);
const res = await fetch(DOWNLOAD_URL, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
if (!res.ok) {
  log(`download falhou: HTTP ${res.status}`);
  process.exit(1);
}
const data = Buffer.from(await res.arrayBuffer());
const actual = sha256(data);
if (actual !== SHA256) {
  log(`CHECKSUM DIFERENTE — arquivo descartado.\n  esperado ${SHA256}\n  recebido ${actual}`);
  process.exit(1);
}
// Written under a temporary name and moved only after the check.
const partial = `${target}.partial`;
writeFileSync(partial, data);
rmSync(target, { force: true });
renameSync(partial, target);
log(`WinSW ${VERSION} salvo em installer/vendor (sha256 ${actual.slice(0, 12)}…, conferido).`);
