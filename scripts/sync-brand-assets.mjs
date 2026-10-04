// Copies brand assets (packages/ui/assets/brand) into each Next.js app's public/brand folder.
// Runs before `dev` and `build` of apps/web and apps/menu. The copies are gitignored.
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { root } from './lib.mjs';

const source = path.join(root, 'packages', 'ui', 'assets', 'brand');
for (const app of ['web', 'menu']) {
  const target = path.join(root, 'apps', app, 'public', 'brand');
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}
