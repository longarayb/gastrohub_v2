import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileCredentialStore } from './credential.js';

describe.runIf(process.platform === 'win32')('credential (Windows DPAPI)', () => {
  it('stores the credential encrypted and reads it back', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'agent-cred-')), 'credential.bin');
    const store = new FileCredentialStore(file);
    expect(await store.load()).toBeNull();
    const token = 'tok_' + 'x'.repeat(60);
    await store.save(token);
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain(token);
    expect(await store.load()).toBe(token);
    await store.clear();
    expect(await store.load()).toBeNull();
  }, 30_000);
});
