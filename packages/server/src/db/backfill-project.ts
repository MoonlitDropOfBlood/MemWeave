/**
 * v0.7.0: Backfill `sessions.project` from historical observation scopes.
 *
 * Pre-v0.7.0 the sessions table had no project column; observations
 * (v0.5.4+) carry `{ key: 'project', value: <cwd path> }` in their
 * `scopes_json`. This pass resolves the cwd via `resolveProject()` and
 * writes the parsed name into the session row.
 *
 * Scope of backfill (per spec §3):
 *   - Only sessions that have at least one observation with a project scope.
 *   - Sessions whose observations all pre-date v0.5.4 (scopes_json='[]')
 *     are left untouched — there is no data to backfill from.
 *   - Idempotent: `UPDATE ... WHERE project IS NULL` is the guard.
 *
 * Runs once during `openDatabase()` after the column migration. Not
 * exposed as a CLI flag.
 */
import type { Db } from './database.js';
import { logger } from '../server/logger.js';
import { resolveProject } from '../util/resolve-project.js';

export function backfillSessionProjects(db: Db): void {
  const candidates = db.prepare(`
    SELECT DISTINCT s.id AS session_id
    FROM sessions s
    INNER JOIN observations o ON o.session_id = s.id
    WHERE s.project IS NULL
      AND o.scopes_json != '[]'
      AND o.scopes_json LIKE '%"key":"project"%'
  `).all() as Array<{ session_id: string }>;

  if (candidates.length === 0) return;

  let resolved = 0;
  let errored = 0;

  const oldCwdStmt = db.prepare(`
    SELECT scopes_json FROM observations
    WHERE session_id = ? AND scopes_json LIKE '%"key":"project"%'
    ORDER BY timestamp ASC LIMIT 1
  `);
  const updateStmt = db.prepare(
    `UPDATE sessions SET project = ? WHERE id = ? AND project IS NULL`
  );

  const tx = db.transaction(() => {
    for (const row of candidates) {
      try {
        const obs = oldCwdStmt.get(row.session_id) as { scopes_json: string } | undefined;
        if (!obs) continue;
        const scopes = JSON.parse(obs.scopes_json) as Array<{ key: string; value: string }>;
        const projScope = scopes.find((s) => s.key === 'project');
        if (!projScope?.value) continue;
        const project = resolveProject(projScope.value);
        if (!project) continue;
        const r = updateStmt.run(project, row.session_id);
        if (r.changes > 0) resolved++;
      } catch (err) {
        errored++;
        logger.warn(
          { sessionId: row.session_id, err: (err as Error).message },
          'backfill: failed to resolve'
        );
      }
    }
  });

  tx();
  logger.info(
    { candidates: candidates.length, resolved, errored },
    'backfill: session.project populated from historical observations'
  );
}
