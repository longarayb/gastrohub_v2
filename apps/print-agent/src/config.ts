import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

declare const __AGENT_VERSION__: string | undefined;

/** Injected by the bundle (package.json version). */
export const AGENT_VERSION =
  typeof __AGENT_VERSION__ === 'string' ? __AGENT_VERSION__ : '0.0.0-dev';

export const DEFAULT_PORT = 9180;
export const DEFAULT_API_URL = 'http://localhost:3333/api';

export interface AgentOptions {
  /** Base URL of the API, with the /api prefix. */
  apiUrl: string;
  dataDir: string;
  /** Local pairing and status page (127.0.0.1 only). */
  port: number;
  /** Development: every printer prints to text files in the data folder. */
  virtual: boolean;
}

/** Non-secret state kept between restarts (the credential is apart, encrypted). */
export interface SavedSettings {
  apiUrl?: string;
  storeSlug?: string;
  storeName?: string;
  agentName?: string;
}

export function defaultDataDir(): string {
  if (process.env.PRINT_AGENT_DATA) return process.env.PRINT_AGENT_DATA;
  return process.platform === 'win32'
    ? join(process.env.ProgramData ?? 'C:\\ProgramData', 'app-print-agent')
    : join(homedir(), '.app-print-agent');
}

export function parseArgs(argv: string[]): AgentOptions & { showVersion: boolean } {
  const value = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const port = Number(value('--port') ?? process.env.PRINT_AGENT_PORT ?? DEFAULT_PORT);
  return {
    apiUrl: (value('--api') ?? process.env.PRINT_AGENT_API_URL ?? '').replace(/\/+$/, ''),
    dataDir: value('--data') ?? defaultDataDir(),
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT,
    virtual: argv.includes('--virtual') || process.env.PRINT_AGENT_VIRTUAL === '1',
    showVersion: argv.includes('--version'),
  };
}

export const settingsFile = (dataDir: string) => join(dataDir, 'settings.json');
export const credentialFile = (dataDir: string) => join(dataDir, 'credential.bin');
export const virtualDir = (dataDir: string) => join(dataDir, 'impressoes');
export const logsDir = (dataDir: string) => join(dataDir, 'logs');

export async function loadSettings(dataDir: string): Promise<SavedSettings> {
  try {
    return JSON.parse(await readFile(settingsFile(dataDir), 'utf8')) as SavedSettings;
  } catch {
    return {};
  }
}

export async function saveSettings(dataDir: string, settings: SavedSettings): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(settingsFile(dataDir), JSON.stringify(settings, null, 2), 'utf8');
}
