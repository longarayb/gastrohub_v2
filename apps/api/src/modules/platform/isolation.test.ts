import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * D041: outside the platform module, only its restricted surface may be imported (same rule as
 * eslint.config.js, checked here too so it cannot be silenced by a lint override).
 */
const SRC = path.resolve(import.meta.dirname, '..', '..');
const ALLOWED = new Set([
  'billing-access.service.js',
  'billing.decorators.js',
  'platform.keys.js',
  'platform.module.js',
]);
const EXEMPT = [path.join('modules', 'platform') + path.sep, 'cli' + path.sep];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'generated' ? [] : files(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

describe('platform module isolation', () => {
  it('restaurant code imports only the restricted platform surface', () => {
    const violations: string[] = [];
    for (const file of files(SRC)) {
      const rel = path.relative(SRC, file);
      if (EXEMPT.some((p) => rel.startsWith(p))) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/from '([^']*\/platform\/([^'/]+))'/g)) {
        if (!ALLOWED.has(match[2]!)) violations.push(`${rel} -> ${match[1]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('the cross-tenant directory uses only fixed queries (no generic model access)', () => {
    const source = readFileSync(
      path.join(import.meta.dirname, 'platform-directory.service.ts'),
      'utf8',
    );
    // No dynamic model access like prisma[model] or $queryRawUnsafe.
    expect(source).not.toMatch(/prisma\[|\$queryRawUnsafe|\$executeRawUnsafe/);
  });
});
