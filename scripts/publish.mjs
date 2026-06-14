#!/usr/bin/env node
/**
 * publish.mjs — build + dry-run + publish @mem-weave/* packages in
 * dependency order (server -> opencode-plugin).
 *
 * As of v0.4 the MCP server is embedded in @mem-weave/server (exposed
 * at GET/POST /mcp via Streamable HTTP transport), so the standalone
 * @mem-weave/mcp package has been retired and removed from the registry.
 *
 * For the server package, the web UI (Vite SPA) is built and copied into
 * dist/web/ so `npx @mem-weave/server start` serves the full UI at /ui/.
 *
 * Modes:
 *   node scripts/publish.mjs                Dry-run every package (default; safe)
 *   node scripts/publish.mjs --dry-run      Same as above
 *   node scripts/publish.mjs --publish      Actually publish (reads NPM_TOKEN from env)
 *   node scripts/publish.mjs --publish <pkg>   Publish only one (server|opencode-plugin)
 *
 * The npm publish reads ~/.npmrc or $NPM_TOKEN directly. This script
 * NEVER stores or prints the token.
 */
import { execSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const PACKAGES = [
  { name: '@mem-weave/server',           dir: 'packages/server' },
  { name: '@mem-weave/opencode-plugin',  dir: 'packages/opencode-plugin' }
];

const args = process.argv.slice(2);
const doPublish = args.includes('--publish');
const onlyPkg = doPublish && args[args.indexOf('--publish') + 1];

function pkgNameMatches(p) {
  if (!onlyPkg) return true;
  if (onlyPkg === 'server') return p.name === '@mem-weave/server';
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

  // 1. Build server TypeScript
  run('npx tsc -p tsconfig.json', resolve(root, p.dir));

  // 1b. For the server package, build the web SPA and bundle it into dist/web/
  //     so the HTTP server can serve /ui/ from the npm package. Also copy
  //     the repo-level README files so the npm tarball ships them.
  if (p.name === '@mem-weave/server') {
    const webDist = resolve(root, 'dist/web');
    const serverDistWeb = resolve(root, p.dir, 'dist/web');

    // Build the web app (Vite outputs to <root>/dist/web/)
    run('npm run web:build', root);

    // Copy into the server package so `../../dist/web` resolves inside the package
    if (existsSync(serverDistWeb)) rmSync(serverDistWeb, { recursive: true });
    cpSync(webDist, serverDistWeb, { recursive: true });
    console.log(`  → web UI copied to ${p.dir}/dist/web/ (${readFileSync(serverDistWeb + '/index.html', 'utf8').length} bytes)`);

    // Ship the README(s) inside the server tarball so npm install
    // gives users a discoverable entry point. Both languages so the
    // user can pick whichever they read first.
    for (const readme of ['README.md', 'README.en.md']) {
      const src = resolve(root, readme);
      if (!existsSync(src)) continue;
      cpSync(src, resolve(root, p.dir, readme));
    }
  }

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
