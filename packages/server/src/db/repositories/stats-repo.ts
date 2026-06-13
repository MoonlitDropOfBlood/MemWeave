import type { Db } from '../database.js';
import type { MemoryType, MemoryTier } from '../../core/types.js';
import { ConsolidationRunRepo } from './consolidation-run-repo.js';

export interface ProjectCount {
  project: string;
  count: number;
}

export interface Stats {
  totals: {
    memories: number;
    activeMemories: number;
    sessions: number;
    observations: number;
    edges: number;
    devices: number;
  };
  byTier: Record<MemoryTier, number>;
  byType: Record<MemoryType, number>;
  today: {
    promoted: number;
    evicted: number;
    newMemories: number;
    injectBundles: number;
  };
  recentProjects: ProjectCount[];
  lastConsolidation: { id: string; startedAt: number; summary: string } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class StatsRepo {
  constructor(private readonly db: Db) {}

  getStats(tenantId: string): Stats {
    const now = Date.now();
    const startOfDay = now - (now % DAY_MS);

    // Totals
    const totalsRow = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM memories WHERE tenant_id = ?) AS memories,
        (SELECT COUNT(*) FROM memories WHERE tenant_id = ? AND deleted_at IS NULL) AS activeMemories,
        (SELECT COUNT(*) FROM sessions WHERE tenant_id = ?) AS sessions,
        (SELECT COUNT(*) FROM observations WHERE tenant_id = ?) AS observations,
        (SELECT COUNT(*) FROM edges WHERE tenant_id = ?) AS edges,
        (SELECT COUNT(*) FROM devices WHERE tenant_id = ?) AS devices
    `).get(tenantId, tenantId, tenantId, tenantId, tenantId, tenantId) as {
      memories: number; activeMemories: number; sessions: number;
      observations: number; edges: number; devices: number;
    };

    // By tier (non-deleted only)
    const tierRows = this.db.prepare(`
      SELECT tier, COUNT(*) AS c
      FROM memories WHERE tenant_id = ? AND deleted_at IS NULL
      GROUP BY tier
    `).all(tenantId) as Array<{ tier: MemoryTier; c: number }>;
    const byTier: Record<MemoryTier, number> = { short: 0, medium: 0, long: 0 };
    for (const r of tierRows) byTier[r.tier] = r.c;

    // By type (non-deleted only)
    const typeRows = this.db.prepare(`
      SELECT type, COUNT(*) AS c
      FROM memories WHERE tenant_id = ? AND deleted_at IS NULL
      GROUP BY type
    `).all(tenantId) as Array<{ type: MemoryType; c: number }>;
    const byType: Record<MemoryType, number> = {
      fact: 0, decision: 0, preference: 0, event: 0, project_context: 0,
      lesson: 0, code_pattern: 0, bug: 0, workflow: 0
    };
    for (const r of typeRows) byType[r.type] = r.c;

    // Today
    const todayNewRow = this.db.prepare(`
      SELECT COUNT(*) AS c FROM memories
      WHERE tenant_id = ? AND created_at >= ?
    `).get(tenantId, startOfDay) as { c: number };

    // Recent projects: pull from memory_scopes
    const projectRows = this.db.prepare(`
      SELECT value AS project, COUNT(DISTINCT memory_id) AS c
      FROM memory_scopes
      WHERE tenant_id = ? AND key = 'project'
      GROUP BY value
      ORDER BY c DESC
      LIMIT 10
    `).all(tenantId) as Array<{ project: string; c: number }>;
    const recentProjects: ProjectCount[] = projectRows.map((r) => ({ project: r.project, count: r.c }));

    // Last consolidation
    const runRepo = new ConsolidationRunRepo(this.db);
    const latestRun = runRepo.latestForTenant(tenantId);
    const lastConsolidation = latestRun
      ? { id: latestRun.id, startedAt: latestRun.startedAt, summary: latestRun.summary }
      : null;

    // Today consolidation stats
    const todayConsRow = this.db.prepare(`
      SELECT
        COALESCE(SUM(promoted_count), 0) AS promoted,
        COALESCE(SUM(evicted_count), 0) AS evicted
      FROM consolidation_runs
      WHERE tenant_id = ? AND started_at >= ?
    `).get(tenantId, startOfDay) as { promoted: number; evicted: number };

    return {
      totals: {
        memories: totalsRow.memories,
        activeMemories: totalsRow.activeMemories,
        sessions: totalsRow.sessions,
        observations: totalsRow.observations,
        edges: totalsRow.edges,
        devices: totalsRow.devices
      },
      byTier,
      byType,
      today: {
        promoted: todayConsRow.promoted,
        evicted: todayConsRow.evicted,
        newMemories: todayNewRow.c,
        injectBundles: 0 // v1: not tracked
      },
      recentProjects,
      lastConsolidation
    };
  }
}
