// 批次 A1 验证脚本:确认 node:sqlite 能跑通现有 schema 的关键特性。
// 用法: node scripts/validate-node-sqlite.mjs
// 跑通则证明批次 A 可行。失败则需重新评估 DB 方案。
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// 临时 DB
const dir = mkdtempSync(join(tmpdir(), 'mw-validate-'));
const dbPath = join(dir, 'test.db');
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

console.log('=== 1. PRAGMA via exec (WAL/foreign_keys) ===');
check('WAL mode', db.prepare("PRAGMA journal_mode").get().journal_mode === 'wal');
check('foreign_keys ON', db.prepare("PRAGMA foreign_keys").get().foreign_keys === 1);

console.log('\n=== 2. FTS5 + 外部内容表 + 触发器(照搬现有 schema) ===');
db.exec(`
  CREATE TABLE memories (
    id TEXT PRIMARY KEY, title TEXT, content TEXT, summary TEXT, concepts_text TEXT, deleted_at INTEGER
  );
  CREATE VIRTUAL TABLE memory_fts USING fts5(
    title, summary, content, concepts_text, content='memories', content_rowid='rowid'
  );
  CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memory_fts(rowid, title, summary, content, concepts_text)
    VALUES (new.rowid, new.title, new.summary, new.content, new.concepts_text);
  END;
`);
check('FTS5 virtual table created', true);
check('AFTER INSERT trigger created', true);

console.log('\n=== 3. 插入 + 触发器自动同步 FTS5 ===');
db.prepare("INSERT INTO memories (id, title, content, summary, concepts_text) VALUES (?, ?, ?, ?, ?)")
  .run('m1', 'Strict TypeScript', 'Use noImplicitAny and exactOptionalPropertyTypes', 'Always use strict mode', 'strict mode noImplicitAny');
db.prepare("INSERT INTO memories (id, title, content, summary, concepts_text) VALUES (?, ?, ?, ?, ?)")
  .run('m2', 'Memory leak debugging', 'Use --inspect and Chrome DevTools', 'Debug memory leaks with heap snapshots', 'memory leak inspect');

const ftsCount = db.prepare("SELECT COUNT(*) c FROM memory_fts").get().c;
check('FTS5 trigger auto-synced 2 rows', ftsCount === 2, `got ${ftsCount}`);

console.log('\n=== 4. FTS5 BM25 查询(含特殊字符转义) ===');
// 模拟 bm25-search.ts 的转义逻辑
const query = "strict mode";
const tokens = query.replace(/[^\w\s\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(w => w.length > 0).map(w => `"${w}"`);
const safe = tokens.join(' ');
const hits = db.prepare(`
  SELECT m.id, m.title, bm25(memory_fts) AS score
  FROM memory_fts JOIN memories m ON m.rowid = memory_fts.rowid
  WHERE memory_fts MATCH ? ORDER BY score DESC LIMIT 5
`).all(safe);
check('FTS5 MATCH query works', hits.length > 0, `hits=${hits.length}`);
check('FTS5 returns correct memory', hits[0]?.id === 'm1', `top=${hits[0]?.id} title=${hits[0]?.title}`);

console.log('\n=== 5. 命名参数绑定(关键差异点) ===');
// better-sqlite3 用匿名对象 {name}, node:sqlite 用 :name/@name/$name
// 测试 node:sqlite 的命名参数语法
const stmt = db.prepare("SELECT id, title FROM memories WHERE id = :id");
const row = stmt.get({ ':id': 'm1' });
check('named param :name works', row?.id === 'm1', `got ${row?.id}`);

// 也测试 @name 和 $name 两种
const stmt2 = db.prepare("SELECT id FROM memories WHERE title = @title");
const row2 = stmt2.get({ '@title': 'Strict TypeScript' });
check('named param @name works', row2?.id === 'm1');

const stmt3 = db.prepare("SELECT id FROM memories WHERE id = $id");
const row3 = stmt3.get({ $id: 'm2' });
check('named param $name works', row3?.id === 'm2');

console.log('\n=== 6. 位置参数绑定(?) ===');
const pos = db.prepare("SELECT id FROM memories WHERE title = ?").get('Memory leak debugging');
check('positional param ? works', pos?.id === 'm2');

console.log('\n=== 7. run() 返回值(insert/update/delete,无需返回行) ===');
const ins = db.prepare("INSERT INTO memories (id, title, content, summary, concepts_text) VALUES (?, ?, ?, ?, ?)")
  .run('m3', 'test', 'c', 's', 'concepts');
check('run() returns changes count', ins.changes === 1, `changes=${ins.changes}`);
check('run() returns lastInsertRowid', typeof ins.lastInsertRowid !== 'undefined');

console.log('\n=== 8. 事务(BEGIN/COMMIT/ROLLBACK — node:sqlite 无 transaction(fn) helper) ===');
// 验证用原生 BEGIN/COMMIT 能否替代 better-sqlite3 的 transaction(fn)
try {
  db.exec('BEGIN');
  db.prepare("INSERT INTO memories (id, title, content, summary, concepts_text) VALUES (?, ?, ?, ?, ?)").run('tx1', 'a', 'b', 'c', 'd');
  db.prepare("INSERT INTO memories (id, title, content, summary, concepts_text) VALUES (?, ?, ?, ?, ?)").run('tx2', 'e', 'f', 'g', 'h');
  db.exec('COMMIT');
  const cnt = db.prepare("SELECT COUNT(*) c FROM memories WHERE id IN ('tx1','tx2')").get().c;
  check('manual BEGIN/COMMIT transaction works', cnt === 2);
} catch (e) {
  db.exec('ROLLBACK');
  check('manual BEGIN/COMMIT transaction works', false, e.message);
}

// 事务回滚测试
try {
  db.exec('BEGIN');
  db.prepare("INSERT INTO memories (id, title, content, summary, concepts_text) VALUES (?, ?, ?, ?, ?)").run('rb1', 'x', 'x', 'x', 'x');
  throw new Error('intentional');
} catch (e) {
  db.exec('ROLLBACK');
  const cnt = db.prepare("SELECT COUNT(*) c FROM memories WHERE id = 'rb1'").get().c;
  check('ROLLBACK undoes changes', cnt === 0, `cnt=${cnt}`);
}

console.log('\n=== 9. UPDATE 触发器重建 FTS5(现有 schema 有 memories_au) ===');
db.exec(`
  CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, title, summary, content, concepts_text)
    VALUES ('delete', old.rowid, old.title, old.summary, old.content, old.concepts_text);
    INSERT INTO memory_fts(rowid, title, summary, content, concepts_text)
    VALUES (new.rowid, new.title, new.summary, new.content, new.concepts_text);
  END;
`);
db.prepare("UPDATE memories SET title = ? WHERE id = ?").run('Updated Title', 'm1');
// FTS5 外部内容表,'delete'/'delete' 语法需特殊处理,验证是否同步
const ftsHitAfterUpdate = db.prepare("SELECT m.id FROM memory_fts JOIN memories m ON m.rowid = memory_fts.rowid WHERE memory_fts MATCH ? AND m.id = ?").all('"Updated"', 'm1');
check('UPDATE trigger resyncs FTS5', ftsHitAfterUpdate.length > 0, `ftsHit=${ftsHitAfterUpdate.length}`);

console.log('\n=== 10. Float32Array 作为 BLOB 绑定(向量存储用) ===');
db.exec("CREATE TABLE vec_test (id TEXT PRIMARY KEY, embedding BLOB)");
const vec = new Float32Array([0.1, 0.2, 0.3, 0.4]);
// node:sqlite 接受 Uint8Array/Buffer 作为 BLOB
const vecBuf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
db.prepare("INSERT INTO vec_test (id, embedding) VALUES (?, ?)").run('v1', vecBuf);
const read = db.prepare("SELECT embedding FROM vec_test WHERE id = ?").get('v1');
const readVec = new Float32Array(read.embedding.buffer, read.embedding.byteOffset, read.embedding.byteLength / 4);
check('Float32Array BLOB round-trips', readVec[0] === 0.1 && readVec[3] === 0.4, `got ${Array.from(readVec)}`);

console.log('\n=== 11. 纯 JS 向量搜索基准(模拟真实规模) ===');
function bench(n, label) {
  const DIM = 768;
  const store = new Float32Array(n * DIM);
  for (let i = 0; i < n; i++) {
    let norm = 0;
    for (let d = 0; d < DIM; d++) { const v = (Math.random() - 0.5) * 2; store[i*DIM+d] = v; norm += v*v; }
    norm = Math.sqrt(norm);
    for (let d = 0; d < DIM; d++) store[i*DIM+d] /= norm;
  }
  const query = new Float32Array(DIM);
  let qn = 0;
  for (let d = 0; d < DIM; d++) { const v = (Math.random()-0.5)*2; query[d]=v; qn+=v*v; }
  qn = Math.sqrt(qn);
  for (let d = 0; d < DIM; d++) query[d] /= qn;
  const K = 20, ITER = 50;
  // warmup
  for (let it = 0; it < 3; it++) for (let i = 0; i < n; i++) { let dot=0; for (let d=0; d<DIM; d++) dot += store[i*DIM+d]*query[d]; }
  const t0 = performance.now();
  for (let it = 0; it < ITER; it++) {
    const dists = new Float32Array(n);
    for (let i = 0; i < n; i++) { let dot=0; for (let d=0; d<DIM; d++) dot += store[i*DIM+d]*query[d]; dists[i] = 2 - 2*dot; }
  }
  const elapsed = performance.now() - t0;
  console.log(`    ${label}: ${n}×768维 单次扫描 ${(elapsed/ITER).toFixed(3)}ms (${ITER}次平均)`);
}
bench(1000, '1k 向量 ');
bench(5000, '5k 向量 ');
bench(10000, '10k向量 ');
check('JS vector scan benchmarked (see above)', true);

console.log('\n=== 12. 加载现有真实 schema 验证(最关键) ===');
try {
  const schemaPath = resolve(ROOT, 'packages/server/src/db/schema.ts');
  const schemaSrc = readFileSync(schemaPath, 'utf8');
  // 提取 SCHEMA_SQL 模板字符串内容
  const match = schemaSrc.match(/SCHEMA_SQL\s*=\s*`([\s\S]*?)`/);
  if (match) {
    let schemaSql = match[1];
    // 去掉 vec0 相关(我们不再用 sqlite-vec)
    schemaSql = schemaSql.replace(/CREATE VIRTUAL TABLE IF NOT EXISTS[\s\S]*?USING vec0\([^)]*\);/g, '-- vec0 removed');
    const db2 = new DatabaseSync(':memory:');
    db2.exec("PRAGMA journal_mode = WAL");
    db2.exec("PRAGMA foreign_keys = ON");
    db2.exec(schemaSql);
    check('real schema loads under node:sqlite (FTS5+triggers+indexes)', true);
    // 验证关键表都在
    const tables = db2.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
    check('memories table present', tables.includes('memories'));
    check('memory_fts table present', tables.includes('memory_fts'));
    check('edges table present', tables.includes('edges'));
    check('observations table present', tables.includes('observations'));
    check('tenants table present', tables.includes('tenants'));
    db2.close();
  } else {
    check('real schema loads under node:sqlite', false, 'SCHEMA_SQL not found in schema.ts');
  }
} catch (e) {
  check('real schema loads under node:sqlite', false, e.message);
}

console.log('\n========================================');
console.log(`结果: ${pass} 通过, ${fail} 失败`);
console.log(fail === 0 ? '🎉 node:sqlite 方案可行,可进入批次 A 实施' : '⚠️ 有失败项,需重新评估');
console.log('========================================');

db.close();
rmSync(dir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
