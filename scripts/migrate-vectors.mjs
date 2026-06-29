// 批次 A7: 检查 + 迁移旧 vec0 表数据到新 memory_vectors 表。
// 用法: node scripts/migrate-vectors.mjs [--dry-run] [--cleanup]
//
// 旧 schema 在 database.ts 里动态建 memory_vectors_<dim> 虚拟表(vec0)。
// 新 schema 用单一 memory_vectors 普通表存 Float32Array BLOB。
// 这个脚本把旧表里的向量读出来,转存到新表。幂等:已迁移的行不会重复写。
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const cleanup = process.argv.includes('--cleanup');
const dbPath = process.env.MEMWEAVE_DB_PATH ?? resolve(homedir(), '.memweave/data/memweave.db');

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

// 1. 找所有旧 vec0 表(命名 memory_vectors_<dim>)
const oldTables = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'memory_vectors_%'`
).all();

// 排除新表(它不匹配 _<dim> 后缀,但防御性过滤)
const vec0Tables = oldTables.filter(t => /^memory_vectors_\d+$/.test(t.name));

if (vec0Tables.length === 0) {
  console.log('没有旧 vec0 表需要迁移。');
  db.close();
  process.exit(0);
}

// 2. 确保新表存在(与 database.ts 的 VECTOR_TABLE_SQL 一致)
db.exec(`
  CREATE TABLE IF NOT EXISTS memory_vectors (
    memory_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_vectors_tenant_dim
    ON memory_vectors(tenant_id, dimensions);
`);

let totalMigrated = 0;
let totalSkipped = 0;

for (const t of vec0Tables) {
  const dims = parseInt(t.name.replace('memory_vectors_', ''), 10);
  console.log(`\n处理旧表 ${t.name} (dimensions=${dims})`);

  let rows;
  try {
    rows = db.prepare(`SELECT memory_id, tenant_id, embedding FROM ${t.name}`).all();
  } catch (err) {
    console.log(`  跳过: 读 ${t.name} 失败 (${err.message})`);
    continue;
  }
  console.log(`  找到 ${rows.length} 行`);

  const now = Date.now();
  let migrated = 0, skipped = 0;
  for (const row of rows) {
    if (!row.embedding || row.embedding.byteLength === 0) { skipped++; continue; }
    const expectedBytes = dims * 4;
    if (row.embedding.byteLength !== expectedBytes) {
      console.log(`  跳过 ${row.memory_id}: 字节数 ${row.embedding.byteLength} != 预期 ${expectedBytes}`);
      skipped++;
      continue;
    }
    if (dryRun) { migrated++; continue; }
    try {
      db.prepare(`
        INSERT INTO memory_vectors (memory_id, tenant_id, dimensions, embedding, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(memory_id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          dimensions = excluded.dimensions,
          embedding = excluded.embedding,
          updated_at = excluded.updated_at
      `).run(row.memory_id, row.tenant_id, dims, row.embedding, now);
      migrated++;
    } catch (err) {
      console.log(`  失败 ${row.memory_id}: ${err.message}`);
      skipped++;
    }
  }
  console.log(`  ${dryRun ? '(dry-run) 将迁移' : '已迁移'} ${migrated}, 跳过 ${skipped}`);
  totalMigrated += migrated;
  totalSkipped += skipped;
}

console.log(`\n总计: ${dryRun ? '(dry-run) 将迁移' : '已迁移'} ${totalMigrated}, 跳过 ${totalSkipped}`);

if (!dryRun && totalMigrated > 0) {
  const cnt = db.prepare('SELECT COUNT(*) c FROM memory_vectors').get();
  console.log(`新 memory_vectors 表现有 ${cnt.c} 行`);
}

if (!dryRun && cleanup) {
  console.log('\n清理旧 vec0 表:');
  for (const t of vec0Tables) {
    db.exec(`DROP TABLE IF EXISTS ${t.name}`);
    console.log(`  已删除 ${t.name}`);
  }
}

db.close();
