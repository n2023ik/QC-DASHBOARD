#!/usr/bin/env node
import { execSync } from 'child_process';
import { cp, rm } from 'fs/promises';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([a-zA-Z]:)/, ''), '..');
const appDir = path.resolve(root, 'form-of-qc-main');
const outDir = path.resolve(root, 'dist', 'form');

try {
  console.log('Installing form dependencies...');
  execSync('npm install --no-audit --no-fund', { cwd: appDir, stdio: 'inherit' });

  console.log('Building form (vite build with base /form/)...');
  // Build the form with base set to /form/ so assets are referenced under /form/assets
  execSync('npx vite build --base /form/', { cwd: appDir, stdio: 'inherit' });

  console.log('Copying build output to', outDir);
  await rm(outDir, { recursive: true, force: true });
  // ensure parent dist exists
  await rm(path.resolve(root, 'dist'), { recursive: false, force: false }).catch(() => {});
  await cp(path.join(appDir, 'dist'), outDir, { recursive: true });

  console.log('Form build complete. Output at', outDir);
} catch (err) {
  console.error('Form build failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
}
