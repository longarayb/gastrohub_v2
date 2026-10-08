// Builds the Windows release of the print agent (docs/SETUP.md, "Agente de impressão"):
//   1. bundle (dist/agent.cjs) → 2. Node single executable (release/print-agent.exe)
//   3. Windows service files (WinSW) → 4. installer instalar-impressao.exe (Inno Setup, if found)
//
//   pnpm --filter @app/print-agent package -- --api https://api.exemplo.com.br/api
//
// WinSW is not downloaded by this script (no executables fetched at build time): place
// WinSW-x64.exe (https://github.com/winsw/winsw/releases, v2.12.0) in installer/vendor/.
// The release must be signed (code-signing certificate) before going to customers: see ROADMAP.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { BRAND } from '@app/shared';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const log = (message) => process.stdout.write(`[print-agent] ${message}\n`);

const apiUrl = arg('--api');
if (!apiUrl || !/^https?:\/\/.+\/api$/.test(apiUrl)) {
  log('Informe o endereço da API: --api https://api.exemplo.com.br/api');
  process.exit(1);
}
if (process.platform !== 'win32') {
  log('O pacote do agente é gerado no Windows (executável e serviço do Windows).');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const release = join(root, 'release');
mkdirSync(release, { recursive: true });

// 1. Bundle.
execFileSync(process.execPath, [join(root, 'scripts', 'bundle.mjs')], {
  cwd: root,
  stdio: 'inherit',
});

// 2. Single executable: the bundle inside a copy of this Node (24 LTS).
const seaConfig = join(release, 'sea-config.json');
writeFileSync(
  seaConfig,
  JSON.stringify({
    main: join(root, 'dist', 'agent.cjs'),
    output: join(release, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }),
);
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
const exe = join(release, 'print-agent.exe');
copyFileSync(process.execPath, exe);
execFileSync(
  process.execPath,
  [
    require.resolve('postject/dist/cli.js'),
    exe,
    'NODE_SEA_BLOB',
    join(release, 'sea-prep.blob'),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  { stdio: 'inherit' },
);
log(`executável: ${exe}`);

// 3. Windows service (WinSW): starts with Windows, restarts on failure.
const serviceName = `${BRAND.name} · Impressão automática`;
const xml = readFileSync(join(root, 'installer', 'service.template.xml'), 'utf8')
  .replaceAll('{{SERVICE_NAME}}', serviceName.replace(/[<>&"]/g, ''))
  .replaceAll('{{API_URL}}', apiUrl);
writeFileSync(join(release, 'PrintAgentService.xml'), xml, 'utf8');
const winsw = join(root, 'installer', 'vendor', 'WinSW-x64.exe');
if (!existsSync(winsw)) {
  log('Falta installer/vendor/WinSW-x64.exe (v2.12.0, github.com/winsw/winsw/releases).');
  process.exit(1);
}
copyFileSync(winsw, join(release, 'PrintAgentService.exe'));

// 4. Installer (Inno Setup 6).
const iscc = [
  arg('--iscc'),
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
].find((p) => p && existsSync(p));
if (!iscc) {
  log('Inno Setup 6 não encontrado: arquivos prontos em release/, instalador não gerado.');
  process.exit(0);
}
execFileSync(
  iscc,
  [
    `/DBrandName=${BRAND.name}`,
    `/DAppVersion=${pkg.version}`,
    `/DReleaseDir=${release}`,
    join(root, 'installer', 'print-agent.iss'),
  ],
  { stdio: 'inherit' },
);
log(`instalador: ${join(release, 'instalar-impressao.exe')}`);
