/* eslint-disable no-console -- terminal script */
// Builds the signed release APK of the courier app (D050), locally, without any Expo account:
// prebuild (android/ is generated, never committed) + Gradle with the key of keystore.mjs.
//
//   pnpm --filter @app/courier apk
//
// Needs: bash scripts/android-sdk.sh (JDK 17 + Android SDK), the key (pnpm ... keystore) and,
// for the "rota nova" notices, the Firebase google-services.json in
// ~/.config/app-courier/google-services.json (or COURIER_GOOGLE_SERVICES). Heavy: stop the dev
// servers and the home server first (8 GB machine).
import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(APP, '..', '..');
const CONFIG = path.join(os.homedir(), '.config', 'app-courier');
const log = (msg) => console.log(`\x1b[36m[app]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[app]\x1b[0m ${msg}`);
  process.exit(1);
};

const env = { ...process.env };
env.JAVA_HOME ??= path.join(os.homedir(), '.local', 'jdk-17');
env.ANDROID_HOME ??= path.join(os.homedir(), 'Android', 'Sdk');
env.PATH = `${env.JAVA_HOME}/bin:${env.PATH}`;
if (!existsSync(path.join(env.JAVA_HOME, 'bin', 'java'))) {
  fail('JDK não encontrado: rode bash scripts/android-sdk.sh');
}
if (!existsSync(env.ANDROID_HOME))
  fail('Android SDK não encontrado: rode bash scripts/android-sdk.sh');

// Signing key (never in the repository).
const signingFile = env.COURIER_SIGNING_ENV ?? path.join(CONFIG, 'signing.env');
if (!existsSync(signingFile)) {
  fail(`Chave não encontrada (${signingFile}): pnpm --filter @app/courier keystore`);
}
const signing = Object.fromEntries(
  readFileSync(signingFile, 'utf8')
    .split('\n')
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
// Gradle reads these as project properties (plugins/with-release-signing.js); not on the
// command line, so no passwords in `ps`.
for (const key of [
  'COURIER_KEYSTORE',
  'COURIER_KEYSTORE_PASSWORD',
  'COURIER_KEY_ALIAS',
  'COURIER_KEY_PASSWORD',
]) {
  if (!signing[key]) fail(`${key} faltando em ${signingFile}`);
  env[`ORG_GRADLE_PROJECT_${key}`] = signing[key];
}

const googleServices = env.COURIER_GOOGLE_SERVICES ?? path.join(CONFIG, 'google-services.json');
if (existsSync(googleServices)) {
  env.COURIER_GOOGLE_SERVICES = googleServices;
  log('Firebase: com avisos de rota nova (google-services.json encontrado).');
} else {
  delete env.COURIER_GOOGLE_SERVICES;
  log('Firebase: SEM avisos de rota nova (falta o google-services.json); o app funciona sem eles.');
}

const release = JSON.parse(readFileSync(path.join(APP, 'release.json'), 'utf8'));
const run = (cmd, args, cwd) => {
  const res = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (res.status !== 0) fail(`Falhou: ${cmd} ${args.join(' ')}`);
};

log(`Versão ${release.versionName} (${release.versionCode})`);
log('Compilando o pacote compartilhado...');
run('pnpm', ['--filter', '@app/shared', 'build'], ROOT);
log('Gerando o projeto Android (expo prebuild)...');
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], APP);

// Little memory (Surface: 5 GB for WSL): one worker, a capped Gradle JVM, Kotlin inside it.
appendFileSync(
  path.join(APP, 'android', 'gradle.properties'),
  [
    '',
    '# Courier app build on small machines (scripts/build-apk.mjs).',
    'org.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=640m -XX:+UseSerialGC -Dfile.encoding=UTF-8',
    'org.gradle.workers.max=1',
    'org.gradle.parallel=false',
    'org.gradle.caching=true',
    'kotlin.compiler.execution.strategy=in-process',
    '',
  ].join('\n'),
);

log('Compilando o APK (demora: 20 a 40 min na primeira vez)...');
run('./gradlew', ['assembleRelease', '--no-daemon', '--console=plain'], path.join(APP, 'android'));

const built = path.join(
  APP,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  'release',
  'app-release.apk',
);
if (!existsSync(built)) fail('APK não encontrado depois do build');
mkdirSync(path.join(APP, 'dist'), { recursive: true });
const target = path.join(APP, 'dist', `entregas-${release.versionName}-${release.versionCode}.apk`);
copyFileSync(built, target);

// The APK must carry our key: a debug signature would let anyone publish "updates".
const tools = path.join(env.ANDROID_HOME, 'build-tools');
const version = readdirSync(tools)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .pop();
const apksigner = path.join(tools, version ?? '', 'apksigner');
if (!existsSync(apksigner)) fail('apksigner não encontrado: rode bash scripts/android-sdk.sh');
const signed = execFileSync(apksigner, ['verify', '--print-certs', target], {
  env,
  encoding: 'utf8',
})
  .split('\n')
  .find((l) => l.includes('SHA-256 digest'))
  ?.split(':')
  .pop()
  ?.trim()
  .toLowerCase();
const expected = execFileSync(
  path.join(env.JAVA_HOME, 'bin', 'keytool'),
  [
    '-list',
    '-v',
    '-keystore',
    signing.COURIER_KEYSTORE,
    '-storepass',
    signing.COURIER_KEYSTORE_PASSWORD,
    '-alias',
    signing.COURIER_KEY_ALIAS,
  ],
  { encoding: 'utf8' },
)
  .split('\n')
  .find((l) => l.trim().startsWith('SHA256:'))
  ?.split('SHA256:')[1]
  .replace(/[\s:]/g, '')
  .toLowerCase();
if (!signed || signed !== expected) {
  rmSync(target);
  fail(`O APK não está assinado com a chave do app (APK ${signed}, chave ${expected}): apagado.`);
}
log(`Assinado com a chave do app (SHA-256 ${signed.slice(0, 16)}…).`);
log(`APK: ${target}`);
log('Para publicar no servidor de casa: pnpm servidor:apk');
