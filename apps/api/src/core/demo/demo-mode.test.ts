import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MODULES = path.join(import.meta.dirname, '..', '..', 'modules');

function controllers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllers(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

/**
 * Deletions are refused in the public demo (D045). A new DELETE route must say what it is:
 * `@BlockedInDemo()` (registration data) or `@AllowedInDemo()` (part of selling).
 */
describe('demo mode marks', () => {
  it('every DELETE route is marked as blocked or allowed in the demo', () => {
    const unmarked: string[] = [];
    for (const file of controllers(MODULES)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.trim().startsWith('@Delete(')) return;
        // The decorators right above the route (until the previous blank line or method).
        const above: string[] = [];
        for (let j = i - 1; j >= 0 && lines[j]!.trim().startsWith('@'); j--) above.push(lines[j]!);
        if (!above.some((l) => /@(BlockedInDemo|AllowedInDemo)\(\)/.test(l))) {
          unmarked.push(`${path.relative(MODULES, file)}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(unmarked).toEqual([]);
  });
});
