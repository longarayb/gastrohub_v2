/* eslint-disable no-console -- terminal script */
// Creates, ONCE, the signing key of the courier app APK (D050), outside the repository:
//   ~/.config/app-courier/release.jks     the key (keystore)
//   ~/.config/app-courier/signing.env     its passwords and alias (mode 600)
// Every APK must be signed with this same key: Android only installs an update signed by the
// key of the installed app. Refuses to overwrite.
//
//   pnpm --filter @app/courier keystore
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = process.env.COURIER_SIGNING_DIR ?? path.join(os.homedir(), '.config', 'app-courier');
const KEYSTORE = path.join(DIR, 'release.jks');
const ENV_FILE = path.join(DIR, 'signing.env');
const JAVA_HOME = process.env.JAVA_HOME ?? path.join(os.homedir(), '.local', 'jdk-17');
const keytool = path.join(JAVA_HOME, 'bin', 'keytool');

if (existsSync(KEYSTORE) || existsSync(ENV_FILE)) {
  console.error(`A chave já existe em ${DIR}: nada foi alterado.`);
  console.error('Gerar outra impediria atualizar o app nos celulares que já o têm.');
  process.exit(1);
}
if (!existsSync(keytool)) {
  console.error(`keytool não encontrado em ${keytool}: rode antes bash scripts/android-sdk.sh`);
  process.exit(1);
}

mkdirSync(DIR, { recursive: true, mode: 0o700 });
const password = randomBytes(24).toString('base64url');
const alias = 'entregas';
execFileSync(
  keytool,
  [
    '-genkeypair',
    '-v',
    '-storetype',
    'PKCS12',
    '-keystore',
    KEYSTORE,
    '-alias',
    alias,
    '-keyalg',
    'RSA',
    '-keysize',
    '4096',
    '-validity',
    '10000',
    '-storepass',
    password,
    '-keypass',
    password,
    '-dname',
    'CN=App Entregas, OU=Entregas, O=App, C=BR',
  ],
  { stdio: 'ignore' },
);
writeFileSync(
  ENV_FILE,
  [
    `COURIER_KEYSTORE=${KEYSTORE}`,
    `COURIER_KEYSTORE_PASSWORD=${password}`,
    `COURIER_KEY_ALIAS=${alias}`,
    `COURIER_KEY_PASSWORD=${password}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);
const fingerprint = execFileSync(
  keytool,
  ['-list', '-v', '-keystore', KEYSTORE, '-storepass', password, '-alias', alias],
  { encoding: 'utf8' },
)
  .split('\n')
  .find((l) => l.trim().startsWith('SHA256:'))
  ?.trim();

console.log(`
Chave de assinatura criada em ${DIR}
  ${fingerprint ?? ''}

GUARDE UMA CÓPIA AGORA no gerenciador de senhas (um item "App entregador — chave de assinatura"):
  1. O arquivo ${KEYSTORE} como anexo
     (ou o texto do comando: base64 -w0 ${KEYSTORE}).
  2. O conteúdo de ${ENV_FILE} (senha e alias).
  3. A impressão digital SHA256 acima (para conferir a chave no futuro).

SE A CHAVE FOR PERDIDA: nenhum celular aceita mais atualizações deste app. Seria preciso
gerar uma chave nova e cada entregador teria de DESINSTALAR o app e instalar de novo (perdendo
o que estiver na fila sem sinal). Na Play Store, perder esta chave também impede publicar
atualizações do mesmo app.

Nunca coloque estes arquivos no repositório (o commit do projeto recusa .jks e .env).
`);
