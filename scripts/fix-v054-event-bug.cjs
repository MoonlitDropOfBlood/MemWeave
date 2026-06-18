// scripts/fix-v054-event-bug.cjs
//
// v0.5.4 (commit 318935f) introduced a bug in the value-gate that
// auto-promoted any chat.user / chat.assistant observation longer
// than 50/200 chars as type='event'. As a result, every plugin-
// written message in 0.5.4 was promoted to a memory with
// source='agent_capture' and type='event' — a category error
// (raw conversation turns are NOT events; an event memory should
// describe a discrete thing that happened in the world).
//
// 117 such memories were created in the user DB.
//
// v0.5.5 fixes the value-gate (removes the buggy rules). This
// script soft-deletes the 0.5.4-era `event / agent_capture`
// memories that were created by the bug. Memories with source =
// 'user_explicit' (typed by the user via the MCP memory_save tool)
// are NOT touched - those reflect real, intentional saves.
//
// After this script, a single consolidation run marks any
// remaining unprocessed observations as processed (without
// creating new memories, since the value-gate no longer
// auto-promotes chat.* observations).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const dbPath = process.env.MEMWEAVE_DB
  || path.join(os.homedir(), '.memweave', 'data', 'memweave.db');

if (!fs.existsSync(dbPath)) {
  console.error('db file not found:', dbPath);
  process.exit(1);
}

let Database;
try {
  Database = require(path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'npm', 'node_modules', '@mem-weave', 'server', 'node_modules',
    'better-sqlite3'
  ));
} catch (e) {
  console.error('Cannot load better-sqlite3 from installed @mem-weave/server.');
  console.error('Run `npm install -g @mem-weave/server` first, or set MEMWEAVE_DB.');
  process.exit(1);
}

const db = new Database(dbPath);
const now = Date.now();

const before = db.prepare(
  "SELECT COUNT(*) as n FROM memories WHERE deleted_at IS NULL AND type = 'event' AND source = 'agent_capture'"
).get().n;

console.log(`Memories to fix: ${before} (type=event, source=agent_capture, the buggy 0.5.4 ones)`);

if (before === 0) {
  console.log('Nothing to do. Done.');
  db.close();
  process.exit(0);
}

const dryRun = process.argv.includes('--dry-run');
if (dryRun) {
  const sample = db.prepare(
    "SELECT id, title, created_at FROM memories WHERE deleted_at IS NULL AND type = 'event' AND source = 'agent_capture' ORDER BY created_at DESC LIMIT 3"
  ).all();
  console.log('DRY RUN - sample (would soft-delete):');
  for (const r of sample) {
    console.log(`  ${r.id.substring(0,8)} | ${new Date(r.created_at).toISOString()} | ${r.title.substring(0,60)}`);
  }
  console.log('Re-run without --dry-run to actually soft-delete.');
  db.close();
  process.exit(0);
}

const tx = db.transaction(() => {
  // 1. Soft-delete the buggy event memories
  const result = db.prepare(`
    UPDATE memories
    SET deleted_at = ?, eviction_reason = ?
    WHERE deleted_at IS NULL AND type = 'event' AND source = 'agent_capture'
  `).run(now, 'v0_5_4_event_category_error_fix');
  // 2. Unlink the associated observations so they could be
  //    re-evaluated under v0.5.5 rules (which won't auto-promote
  //    them, but at least the memory_id pointer doesn't dangle).
  db.prepare(`
    UPDATE observations
    SET memory_id = NULL, processed = 0
    WHERE memory_id IN (
      SELECT id FROM memories
      WHERE deleted_at IS NOT NULL AND eviction_reason = 'v0_5_4_event_category_error_fix'
    )
  `).run();
  return result.changes;
});

const changed = tx();
console.log(`Soft-deleted ${changed} event/agent_capture memories from v0.5.4.`);
console.log('The linked observations have been reset to processed=0 + memory_id=NULL.');
console.log('Run `POST /api/v1/consolidate` to drain them - under v0.5.5');
console.log('the value-gate will reject them (no auto-promotion of raw');
console.log('conversation turns; the agent should call memory_save explicitly');
console.log('when it wants to remember something).');

db.close();
