// scripts/db/cleanup-duplicates.js
//
// Remove existing duplicate memories from a MemWeave SQLite database.
// A duplicate is defined as: same tenant + same type + same content
// (after whitespace-normalization). The OLDEST row is kept; the
// rest are soft-deleted (deleted_at = now).
//
// Usage:  node scripts/db/cleanup-duplicates.js [path-to-db]
//   default db path: ~/.memweave/data/memweave.db
//
// Idempotent: running it twice is safe (the second run finds nothing).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let Database;
try {
  // Try the install path that ships with @mem-weave/server
  Database = require('@mem-weave/server/node_modules/better-sqlite3');
} catch {
  Database = require('better-sqlite3');
}

const dbPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(os.homedir(), '.memweave', 'data', 'memweave.db');

if (!fs.existsSync(dbPath)) {
  console.error(`db file not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);

// Find duplicates: group by (tenant_id, type, normalized_content)
// We do the normalization in JS rather than SQL for clarity.
const all = db.prepare(`
  SELECT id, tenant_id, type, content, created_at
  FROM memories
  WHERE deleted_at IS NULL
  ORDER BY created_at ASC
`).all();

const groups = new Map();
for (const m of all) {
  const key = [m.tenant_id, m.type, m.content.replace(/\s+/g, ' ').trim().toLowerCase()].join('|');
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(m);
}

const toDel = [];
for (const [, list] of groups) {
  if (list.length > 1) {
    // Keep the first (oldest); soft-delete the rest.
    for (let i = 1; i < list.length; i++) toDel.push(list[i].id);
  }
}

if (toDel.length === 0) {
  const remaining = db.prepare('SELECT COUNT(*) as n FROM memories WHERE deleted_at IS NULL').get().n;
  console.log(`no duplicates found. ${remaining} memories remain.`);
  db.close();
  process.exit(0);
}

const softDel = db.prepare('UPDATE memories SET deleted_at = ? WHERE id = ?');
const now = Date.now();
const tx = db.transaction(() => {
  for (const id of toDel) softDel.run(now, id);
});
tx();

const remaining = db.prepare('SELECT COUNT(*) as n FROM memories WHERE deleted_at IS NULL').get().n;
console.log(`soft-deleted ${toDel.length} duplicate memories (${remaining} unique memories remain).`);
console.log('run again to verify idempotency.');

db.close();
