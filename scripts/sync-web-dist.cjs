// scripts/sync-web-dist.cjs
//
// `npm run web:build` writes Vite's output to D:\ai-projects\memory\dist\web\.
// BUT the installed @mem-weave/server (in C:\Users\wwhby\AppData\Roaming\npm\)
// serves static files from its OWN dist\web\, NOT the source tree's. So the
// web build NEVER reaches the running server unless copied manually.
//
// This script syncs dist\web\ from the source tree to the installed server
// location, so browser refreshes see the latest code immediately.
//
// Idempotent. Re-running overwrites cleanly.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SRC = path.resolve(__dirname, '..', 'dist', 'web');
const HOMEDIR = os.homedir();
const DST = path.join(
  process.env.APPDATA || path.join(HOMEDIR, 'AppData', 'Roaming'),
  'npm', 'node_modules', '@mem-weave', 'server', 'dist', 'web'
);

if (!fs.existsSync(SRC)) {
  console.error('Source not built. Run `npm run web:build` first.');
  console.error('  expected:', SRC);
  process.exit(1);
}

if (!fs.existsSync(path.dirname(DST))) {
  console.error('Installed @mem-weave/server not found.');
  console.error('  expected:', path.dirname(DST));
  console.error('  run: npm install -g @mem-weave/server');
  process.exit(1);
}

// Make sure dst exists
fs.mkdirSync(DST, { recursive: true });

let copied = 0;
function copyRecursive(srcDir, dstDir) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      copied++;
    }
  }
}
copyRecursive(SRC, DST);

// Clean up files that exist in dst but no longer in src (e.g. removed assets)
function pruneRemoved(srcDir, dstDir) {
  if (!fs.existsSync(dstDir)) return;
  for (const entry of fs.readdirSync(dstDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (!fs.existsSync(s)) {
      fs.rmSync(d, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      pruneRemoved(s, d);
    }
  }
}
pruneRemoved(SRC, DST);

console.log('synced', copied, 'files');
console.log('  from:', SRC);
console.log('  to:  ', DST);
console.log('\nRestart memweave server to pick up the new bundle:');
console.log('  memweave stop && memweave start');
