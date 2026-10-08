// Bundles the agent into a single CommonJS file (dist/agent.cjs), ready for a Node single
// executable (scripts/package.mjs). `--metafile` writes dist/meta.json to inspect its size.
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const result = await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/agent.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  minify: true,
  keepNames: true,
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  // socket.io-client: optional native helpers of the ws transport.
  external: ['bufferutil', 'utf-8-validate'],
  define: { __AGENT_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'warning',
});
if (process.argv.includes('--metafile')) {
  writeFileSync('dist/meta.json', JSON.stringify(result.metafile));
}
const bytes = Object.values(result.metafile.outputs)[0].bytes;
process.stdout.write(`[print-agent] dist/agent.cjs ${(bytes / 1024).toFixed(0)} KB\n`);
