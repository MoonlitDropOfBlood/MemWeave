#!/usr/bin/env node
/**
 * publish.mjs — build + dry-run + publish all 3 @mem-weave/* packages in
 * dependency order (server -> mcp -> opencode-plugin).
 *
 * Modes:
 *   node scripts/publish.mjs                Dry-run every package (default; safe)
 *   node scripts/publish.mjs --dry-run      Same as above
 *   node scripts/publish.mjs --publish      Actually publish (reads NPM_TOKEN from env)
 *   node scripts/publish.mjs --publish <pkg>   Publish only one (server|mcp|opencode-plugin)
 *
 * The npm publish reads ~/.npmrc or $NPM_TOKEN directly. This script
 * NEVER stores or prints the token.
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const PACKAGES = [
  { name: '@mem-weave/server',           dir: 'packages/server' },
  { name: '@mem-weave/mcp',              dir: 'packages/mcp' },
  { name: '@mem-weave/opencode-plugin',  dir: 'packages/opencode-plugin' }
];

const args = process.argv.slice(2);
const doPublish = args.includes('--publish');
const onlyPkg = doPublish && args[args.indexOf('--publish') + 1];

function pkgNameMatches(p) {
  if (!onlyPkg) return true;
  if (onlyPkg === 'server') return p.name === '@mem-weave/server';
  if (onlyPkg === 'mcp') return p.name === '@mem-weave/mcp';
  if (onlyPkg === 'opencode-plugin') return p.name === '@mem-weave/opencode-plugin';
  return false;
}

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}  (cwd=${cwd})`);
  const res = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true });
  if (res.status !== 0) {
    throw new Error(`Command failed (exit ${res.status}): ${cmd}`);
  }
}

function readVersion(pkgDir) {
  const pkg = JSON.parse(readFileSync(resolve(root, pkgDir, 'package.json'), 'utf8'));
  return { name: pkg.name, version: pkg.version };
}

console.log('MemWeave publish script');
console.log('=========================');
console.log('Mode:', doPublish ? 'PUBLISH' : 'DRY-RUN');
if (onlyPkg) console.log('Only:', onlyPkg);
console.log('');

for (const p of PACKAGES) {
  if (!pkgNameMatches(p)) continue;
  const v = readVersion(p.dir);
  console.log(`\n--- ${v.name}@${v.version} (${p.dir}) ---`);

  // 1. Build
  run('npx tsc -p tsconfig.json', resolve(root, p.dir));

  // 2. Verify the tarball would contain the right files
  run('npm pack --dry-run', resolve(root, p.dir));

  if (doPublish) {
    // 3. Publish (npm reads NPM_TOKEN from env or ~/.npmrc)
    run('npm publish --access public', resolve(root, p.dir));
    console.log(`✓ ${v.name}@${v.version} published`);
  } else {
    console.log(`(dry-run; would have run: npm publish --access public from ${p.dir})`);
  }
}

console.log('\n=========================');
console.log(doPublish ? 'Publish complete.' : 'Dry-run complete. Re-run with --publish to actually publish.');
