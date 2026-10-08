import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runPowerShell } from './powershell.js';

/** Long-lived credential of the paired agent. Never logged, never shown on the local page. */
export interface CredentialStore {
  load(): Promise<string | null>;
  save(token: string): Promise<void>;
  clear(): Promise<void>;
}

const PROTECT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd().Trim())
$sealed = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
[Convert]::ToBase64String($sealed)`;

const UNPROTECT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$sealed = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, 'CurrentUser')
[Text.Encoding]::UTF8.GetString($bytes)`;

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/**
 * Windows: encrypted with DPAPI for the account that runs the agent (the service account), so a
 * copy of the file is useless on another PC or account. Elsewhere (development): a file only
 * the user can read.
 */
export class FileCredentialStore implements CredentialStore {
  constructor(
    private readonly file: string,
    private readonly dpapi = process.platform === 'win32',
  ) {}

  async load(): Promise<string | null> {
    let stored: string;
    try {
      stored = (await readFile(this.file, 'utf8')).trim();
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
    if (!stored) return null;
    return this.dpapi ? runPowerShell(UNPROTECT, stored) : stored;
  }

  async save(token: string): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const stored = this.dpapi ? await runPowerShell(PROTECT, token) : token;
    await writeFile(this.file, stored, { encoding: 'utf8', mode: 0o600 });
    if (!this.dpapi) await chmod(this.file, 0o600);
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true });
  }
}
