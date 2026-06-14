/**
 * Local type declarations for MemWeave REST API.
 * Kept narrow: only fields the SPA actually renders. For full records,
 * the server is the source of truth.
 */

export type MemoryTier = 'short' | 'medium' | 'long';
export type MemoryType =
  | 'fact' | 'decision' | 'preference' | 'event' | 'project_context'
  | 'lesson' | 'code_pattern' | 'bug' | 'workflow';

export type EdgeType =
  | 'causes' | 'enables' | 'contradicts' | 'supersedes' | 'references'
  | 'related_to' | 'before' | 'after' | 'duplicates' | 'refines';

export interface ScopeTag {
  key: 'project' | 'domain' | 'topic';
  value: string;
}

export interface Memory {
  id: string;
  type: MemoryType;
  tier: MemoryTier;
  title: string;
  summary: string;
  content: string;
  concepts: string[];
  files: string[];
  importance: number;
  confidence: number;
  strength: number;
  source: 'user_explicit' | 'agent_capture' | 'system_inferred';
  scopeLevel: 'global' | 'project';
  scopes: ScopeTag[];
  sourceClient: string | null;
  sourceDeviceId: string | null;
  sourceSessionId: string | null;
  accessCount: number;
  lastAccessedAt: number | null;
  lastReinforcedAt: number | null;
  lastDecayAt: number | null;
  reinforcementScore: number;
  promotedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  evictionReason: string | null;
}

export interface MemoryListResponse {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

export interface SearchResult {
  memoryId: string;
  type: MemoryType;
  tier: MemoryTier;
  title: string;
  summary: string;
  finalScore: number;
  sources: string[];
}

export interface SearchResponse {
  results: SearchResult[];
  totalCandidates: number;
}

export interface GraphNode {
  id: string;
  type: MemoryType;
  tier: MemoryTier;
  title: string;
  summary: string;
}

export interface GraphEdge {
  id: string;
  fromMemoryId: string;
  toMemoryId: string;
  type: EdgeType;
  strength: number;
  reason: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AccessLog {
  id: string;
  tenantId: string;
  memoryId: string;
  sessionId: string | null;
  deviceId: string | null;
  source: string;
  query: string | null;
  rank: number | null;
  score: number | null;
  usedInContext: boolean;
  accessedAt: number;
}

export interface AccessLogResponse {
  logs: AccessLog[];
  total: number;
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
  recentProjects: Array<{ project: string; count: number }>;
  lastConsolidation: { id: string; startedAt: number; summary: string } | null;
}

export interface ConsolidationRun {
  id: string;
  tenantId: string;
  startedAt: number;
  endedAt: number;
  promoted: string[];
  evicted: string[];
  merged: string[][];
  edgesCreated: number;
  contradictionFound: number;
  dryRun: boolean;
  summary: string;
}

export interface SessionMemorySummary {
  id: string;
  type: string;
  tier: string;
  title: string;
  summary: string;
  strength: number;
  importance: number;
  createdAt: number;
}

export interface Session {
  id: string;
  tenantId: string;
  deviceId: string | null;
  source: string;
  title: string;
  summary: string | null;
  startedAt: number;
  endedAt: number | null;
  observationCount: number;
}

export interface SessionMemoryListResponse {
  memories: SessionMemorySummary[];
  total: number;
}

export interface Device {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  lastSeenAt: number | null;
  registeredAt: number;
}

export interface DeviceCreateResponse {
  device: Device;
  apiKey: string;
  notice: string;
}

export interface Settings {
  server: { host: string; port: number };
  storage: { path: string };
  auth: { defaultTenantName: string; requireAuth: boolean; deviceApiKey?: string };
  embedding: { provider: string; model: string; dimensions: number; batchSize: number; apiKey?: string; baseUrl?: string; isConfigured: boolean };
  llm: { provider: string; model: string; temperature: number; maxTokens: number; apiKey?: string; baseUrl?: string; isConfigured: boolean };
  consolidation: { enabled: boolean; intervalHours: number; accessLogRetentionDays: number };
  injection: { sessionStartBudget: number; promptDeltaBudget: number; filePackBudget: number; failureDeltaBudget: number };
  search: { rrfK: number; bm25Limit: number; vectorLimit: number; graphLimit: number; causalLimit: number; vectorMinSimilarity: number; bm25Only: boolean };
}
