// 批次 C: 回填脚本 — 对存量 concepts 空的 memory 跑 LLM 富化。
// 用法: node scripts/backfill-enrich.mjs [--dry-run] [--batch N] [--db PATH] [--no-embedding]
//
// 存量问题: 975/1015 条 memory 的 concepts 为空,title 是对话原文前 80 字。
// 这个脚本分批调 LLM 生成真正的 title/summary/concepts,同时补向量。
// --no-embedding: 跳过向量补全(当 HuggingFace 模型下载不可达时用,纯做 LLM 富化)。
import { loadConfig, expandPath } from '../packages/server/src/core/config.js';
import { createLlmProvider } from '../packages/server/src/providers/llm/index.js';
import { createEmbeddingProvider } from '../packages/server/src/providers/embedding/index.js';
import { enrichMemories } from '../packages/server/src/workers/enricher.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noEmbedding = args.includes('--no-embedding');
const batchArg = args.find(a => a.startsWith('--batch='));
const batchSize = batchArg ? parseInt(batchArg.split('=')[1], 10) : 25;
const dbArg = args.find(a => a.startsWith('--db='));
const configArg = args.find(a => a.startsWith('--config='));

// Resolve config + db path (mirrors bootstrap.ts logic).
const explicitConfig = configArg ? configArg.split('=')[1] : process.env.MEMWEAVE_CONFIG;
const fallbackConfig = join(homedir(), '.memweave', 'config.jsonc');
const configPath = explicitConfig ?? (existsSync(fallbackConfig) ? fallbackConfig : undefined);
const config = loadConfig(configPath);
const dbPath = dbArg ? dbArg.split('=')[1] : expandPath(config.storage.path);

async function main() {
  console.log(`DB: ${dbPath}`);
  console.log(`LLM: ${config.llm.provider} | Embedding: ${noEmbedding ? 'SKIP (--no-embedding)' : config.embedding.provider}`);
  console.log(`Batch size: ${batchSize} | Dry run: ${dryRun}`);
  console.log('');

  const llm = await createLlmProvider(config.llm.provider, config.llm);
  // Skip embedding entirely when --no-embedding is set (model download blocked
  // by network → each failed embed() call burns a timeout and stalls the run).
  const embedding = noEmbedding ? undefined : createEmbeddingProvider({
    kind: config.embedding.provider,
    baseUrl: config.embedding.baseUrl,
    apiKey: config.embedding.apiKey,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions
  });

  let totalEnriched = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let round = 0;

  // Loop until no more candidates (enrichMemories returns enriched=0 when
  // the batch is empty or all candidates were skipped/failed).
  while (true) {
    round++;
    const result = await enrichMemories(dbPath, 'tenant_default', llm, embedding, { batchSize, dryRun });
    console.log(`Round ${round}: enriched=${result.enriched} failed=${result.failed} skipped=${result.skipped}`);
    totalEnriched += result.enriched;
    totalFailed += result.failed;
    totalSkipped += result.skipped;
    if (result.enriched === 0) break;
    if (dryRun) break; // dry run only shows the first batch
  }

  console.log('');
  console.log(`Done. Total: enriched=${totalEnriched} failed=${totalFailed} skipped=${totalSkipped}`);
  if (dryRun) console.log('(dry-run: no changes written)');
}

main().catch(err => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
