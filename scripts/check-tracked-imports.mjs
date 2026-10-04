// Fails if a tracked source file imports a relative path that is not tracked by git
// (e.g. a folder accidentally matched by .gitignore). Run: node scripts/check-tracked-imports.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './lib.mjs';

const tracked = new Set(
  execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean),
);

const sources = [...tracked].filter(
  (f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.includes('node_modules/') && !f.endsWith('.d.ts'),
);
const importRe =
  /(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
const candidates = (base) => [
  base,
  base.replace(/\.js$/, '.ts'),
  base.replace(/\.js$/, '.tsx'),
  `${base}.ts`,
  `${base}.tsx`,
  `${base}.js`,
  `${base}.mjs`,
  `${base}/index.ts`,
  `${base}/index.tsx`,
];

const missing = [];
for (const file of sources) {
  const text = readFileSync(path.join(root, file), 'utf8');
  for (const match of text.matchAll(importRe)) {
    const spec = match[1] ?? match[2];
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    if (resolved.includes('/generated/')) continue; // generated on install
    if (!candidates(resolved).some((c) => tracked.has(c))) missing.push(`${file} -> ${spec}`);
  }
}

if (missing.length) {
  console.error('Imports pointing to files not tracked by git:');
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}
console.log(`OK: ${sources.length} tracked source files, all relative imports are tracked.`);
