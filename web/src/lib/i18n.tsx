/**
 * Lightweight i18n — React Context + dictionary lookup, zero external deps.
 *
 * Usage:
 *   const { t, locale, setLocale } = useLocale();
 *   t('appShell.nav.memories')  // → "Memories" / "记忆"
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// ── Type ──────────────────────────────────────────────
type Locale = 'en' | 'zh';

// ── Dictionary ────────────────────────────────────────
const dict: Record<Locale, Record<string, string>> = {
  // ── EN — keys fall back to themselves ──
  en: {
    /* AppShell */
    'appShell.nav.atlas': 'Atlas',
    'appShell.nav.memories': 'Memories',
    'appShell.nav.injection': 'Injection',
    'appShell.nav.sleep': 'Sleep',
    'appShell.nav.settings': 'Settings',
    'appShell.searchPlaceholder': 'Search memories…',
    'appShell.toggleTheme': 'Toggle theme',
    'appShell.version': 'v',

    /* AtlasPage */
    'atlasPage.title': 'Atlas',
    'atlasPage.subtitle': 'Memory observatory — strength over time',
    'atlasPage.loading': 'Loading Atlas…',
    'atlasPage.error': 'Failed to load stats:',
    'atlasPage.kpi.totalMemories': 'Total memorias',
    'atlasPage.kpi.active': 'active',
    'atlasPage.kpi.todayNew': 'Today: new',
    'atlasPage.kpi.promoted': 'promoted',
    'atlasPage.kpi.evicted': 'evicted',
    'atlasPage.kpi.edges': 'Edges',
    'atlasPage.kpi.causalAndRef': 'causal + reference',
    'atlasPage.kpi.lastSleep': 'Last sleep',
    'atlasPage.kpi.noRuns': 'no runs yet',
    'atlasPage.section.byTier': 'By tier',
    'atlasPage.section.byType': 'By type',
    'atlasPage.section.recentProjects': 'Recent projects',
    'atlasPage.emptyProjects': 'No scoped memorias yet.',

    /* MemoriesPage */
    'memoriesPage.filters': 'Filters',
    'memoriesPage.filterType': 'Type',
    'memoriesPage.filterTier': 'Tier',
    'memoriesPage.filterProject': 'Project',
    'memoriesPage.projectPlaceholder': 'project value',
    'memoriesPage.loading': 'Loading…',
    'memoriesPage.error': 'Failed to load:',
    'memoriesPage.empty': 'No memorias match these filters.',
    'memoriesPage.total': 'total',
    'memoriesPage.selectHint': 'Select a memory to read it.',
    'memoriesPage.reading.summary': 'Summary',
    'memoriesPage.reading.content': 'Content',
    'memoriesPage.reading.properties': 'Properties',
    'memoriesPage.reading.strength': 'Strength',
    'memoriesPage.reading.importance': 'importance',
    'memoriesPage.reading.confidence': 'confidence',
    'memoriesPage.reading.accessCount': 'Access count',
    'memoriesPage.reading.source': 'Source',
    'memoriesPage.reading.created': 'Created',
    'memoriesPage.reading.lastAccessed': 'Last accessed',
    'memoriesPage.reading.expandGraph': 'Expand graph',
    'memoriesPage.reading.forget': 'Forget',
    'memoriesPage.confirmForget': 'Forget memory "{title}"?',

    /* MemoryDetailPage */
    'memoryDetail.loading': 'Loading…',
    'memoryDetail.notFound': 'Not found',
    'memoryDetail.summary': 'Summary',
    'memoryDetail.content': 'Content',
    'memoryDetail.properties': 'Properties',
    'memoryDetail.strength': 'Strength',
    'memoryDetail.importance': 'importance',
    'memoryDetail.confidence': 'confidence',
    'memoryDetail.accessCount': 'Access count',
    'memoryDetail.source': 'Source',
    'memoryDetail.created': 'Created',
    'memoryDetail.lastAccessed': 'Last accessed',
    'memoryDetail.tab.graph': 'Graph',
    'memoryDetail.tab.accessLogs': 'Access logs',
    'memoryDetail.emptyEdges': 'No connected edges.',
    'memoryDetail.emptyLogs': 'No access recorded yet.',
    'memoryDetail.th.when': 'When',
    'memoryDetail.th.source': 'Source',
    'memoryDetail.th.usedInContext': 'Used in context',
    'memoryDetail.th.query': 'Query',
    'memoryDetail.edgeStrength': 'strength',

    /* InjectionPage */
    'injectionPage.title': 'Injection',
    'injectionPage.subtitle': 'Audit what the agent would see',
    'injectionPage.formTitle': 'Request a preview',
    'injectionPage.field.phase': 'Phase',
    'injectionPage.field.sessionId': 'Session ID',
    'injectionPage.field.query': 'Query',
    'injectionPage.field.files': 'Files (comma-separated, optional)',
    'injectionPage.submit': 'Preview injection bundle',
    'injectionPage.computing': 'Computing…',
    'injectionPage.meta.bundleId': 'Bundle ID',
    'injectionPage.meta.phase': 'Phase',
    'injectionPage.meta.contentHash': 'Content hash',
    'injectionPage.meta.memories': 'Memories',
    'injectionPage.meta.estimatedTokens': 'Estimated tokens',
    'injectionPage.sectionXml': 'Context XML',
    'injectionPage.empty': 'Submit the form to preview an injection bundle.',

    /* SleepPage */
    'sleepPage.title': 'Sleep',
    'sleepPage.subtitle': 'Consolidation history — promotion, eviction, merging',
    'sleepPage.dryRun': 'Dry run',
    'sleepPage.runNow': 'Run now',
    'sleepPage.running': 'Running…',
    'sleepPage.runFailed': 'Run failed:',
    'sleepPage.loading': 'Loading runs…',
    'sleepPage.error': 'Failed to load:',
    'sleepPage.empty': 'No sleep cycles yet. Click "Run now" to start one.',
    'sleepPage.cycle': 'Sleep Cycle #',
    'sleepPage.dryRunBadge': 'dry-run',
    'sleepPage.started': 'Started:',
    'sleepPage.ended': 'Ended:',
    'sleepPage.edgesCreated': 'Edges created:',
    'sleepPage.contradictions': 'Contradictions:',
    'sleepPage.noChanges': 'No changes in this cycle.',
    'sleepPage.promoted': 'promoted',
    'sleepPage.evicted': 'evicted',
    'sleepPage.merged': 'merged',

    /* SettingsPage */
    'settingsPage.title': 'Settings',
    'settingsPage.subtitle': 'Server configuration and registered devices',
    'settingsPage.section.server': 'Server',
    'settingsPage.section.devices': 'Devices',
    'settingsPage.server.host': 'Host',
    'settingsPage.server.port': 'Port',
    'settingsPage.server.dbPath': 'DB path',
    'settingsPage.server.embedding': 'Embedding provider',
    'settingsPage.server.llm': 'LLM provider',
    'settingsPage.server.consolidation': 'Consolidation',
    'settingsPage.server.authRequired': 'Auth required',
    'settingsPage.server.yes': 'yes',
    'settingsPage.server.noDevMode': 'no (dev mode)',
    'settingsPage.server.disabled': 'disabled',
    'settingsPage.server.every': 'every',
    'settingsPage.server.notConfigured': '(no apiKey → noop)',
    'settingsPage.loading': 'Loading…',
    'settingsPage.error': 'Failed to load:',
    'settingsPage.emptyDevices': 'No devices registered yet.',
    'settingsPage.table.name': 'Name',
    'settingsPage.table.type': 'Type',
    'settingsPage.table.registered': 'Registered',
    'settingsPage.table.lastSeen': 'Last seen',
    'settingsPage.revoke': 'Revoke',
    'settingsPage.confirmRevoke': 'Revoke device "{name}"?',
    'settingsPage.registerDevice': '+ Register device',
    'settingsPage.dialog.title': 'Register a new device',
    'settingsPage.dialog.name': 'Name',
    'settingsPage.dialog.type': 'Type',
    'settingsPage.dialog.cancel': 'Cancel',
    'settingsPage.dialog.create': 'Create',
    'settingsPage.dialog.creating': 'Creating…',
    'settingsPage.dialog.created': 'Device created',
    'settingsPage.dialog.apiKey': 'API key (copy now — won\'t be shown again)',
    'settingsPage.dialog.copy': 'Copy',
    'settingsPage.dialog.done': 'Done',

    /* GraphPage */
    'graphPage.filters': 'Filters',
    'graphPage.depth': 'Depth',
    'graphPage.direction': 'Direction',
    'graphPage.edgeTypes': 'Edge types',
    'graphPage.option.both': 'both',
    'graphPage.option.outgoing': 'outgoing',
    'graphPage.option.incoming': 'incoming',
    'graphPage.loading': 'Loading graph…',
    'graphPage.error': 'Failed:',
    'graphPage.empty': 'No graph for this memory.',

    /* NotFoundPage */
    'notFound.title': '404',
    'notFound.message': "That page doesn't exist.",
    'notFound.back': 'Back to Atlas',
  },

  // ── ZH ────────────────────────────────
  zh: {
    'appShell.nav.atlas': '仪表盘',
    'appShell.nav.memories': '记忆',
    'appShell.nav.injection': '注入',
    'appShell.nav.sleep': '睡眠',
    'appShell.nav.settings': '设置',
    'appShell.searchPlaceholder': '搜索记忆…',
    'appShell.toggleTheme': '切换主题',
    'appShell.version': 'v',

    'atlasPage.title': '仪表盘',
    'atlasPage.subtitle': '记忆观测站 — 强度随时间变化',
    'atlasPage.loading': '加载中…',
    'atlasPage.error': '加载统计失败：',
    'atlasPage.kpi.totalMemories': '记忆总数',
    'atlasPage.kpi.active': '活跃',
    'atlasPage.kpi.todayNew': '今日新增',
    'atlasPage.kpi.promoted': '升格',
    'atlasPage.kpi.evicted': '淘汰',
    'atlasPage.kpi.edges': '关系边',
    'atlasPage.kpi.causalAndRef': '因果 + 参考',
    'atlasPage.kpi.lastSleep': '上次睡眠',
    'atlasPage.kpi.noRuns': '暂无',
    'atlasPage.section.byTier': '按层级',
    'atlasPage.section.byType': '按类型',
    'atlasPage.section.recentProjects': '近期项目',
    'atlasPage.emptyProjects': '暂无项目级记忆。',

    'memoriesPage.filters': '筛选',
    'memoriesPage.filterType': '类型',
    'memoriesPage.filterTier': '层级',
    'memoriesPage.filterProject': '项目',
    'memoriesPage.projectPlaceholder': '项目名称',
    'memoriesPage.loading': '加载中…',
    'memoriesPage.error': '加载失败：',
    'memoriesPage.empty': '没有符合筛选条件的记忆。',
    'memoriesPage.total': '共计',
    'memoriesPage.selectHint': '选择一条记忆查看详情。',
    'memoriesPage.reading.summary': '摘要',
    'memoriesPage.reading.content': '正文',
    'memoriesPage.reading.properties': '属性',
    'memoriesPage.reading.strength': '强度',
    'memoriesPage.reading.importance': '重要性',
    'memoriesPage.reading.confidence': '置信度',
    'memoriesPage.reading.accessCount': '访问次数',
    'memoriesPage.reading.source': '来源',
    'memoriesPage.reading.created': '创建时间',
    'memoriesPage.reading.lastAccessed': '最后访问',
    'memoriesPage.reading.expandGraph': '展开关系图',
    'memoriesPage.reading.forget': '遗忘',
    'memoriesPage.confirmForget': '确认遗忘记忆"{title}"？',

    'memoryDetail.loading': '加载中…',
    'memoryDetail.notFound': '未找到',
    'memoryDetail.summary': '摘要',
    'memoryDetail.content': '正文',
    'memoryDetail.properties': '属性',
    'memoryDetail.strength': '强度',
    'memoryDetail.importance': '重要性',
    'memoryDetail.confidence': '置信度',
    'memoryDetail.accessCount': '访问次数',
    'memoryDetail.source': '来源',
    'memoryDetail.created': '创建时间',
    'memoryDetail.lastAccessed': '最后访问',
    'memoryDetail.tab.graph': '关系图',
    'memoryDetail.tab.accessLogs': '访问日志',
    'memoryDetail.emptyEdges': '暂无关联边。',
    'memoryDetail.emptyLogs': '暂无访问记录。',
    'memoryDetail.th.when': '时间',
    'memoryDetail.th.source': '来源',
    'memoryDetail.th.usedInContext': '已注入上下文',
    'memoryDetail.th.query': '查询',
    'memoryDetail.edgeStrength': '强度',

    'injectionPage.title': '注入',
    'injectionPage.subtitle': '预览 Agent 的注入内容',
    'injectionPage.formTitle': '发起预览',
    'injectionPage.field.phase': '阶段',
    'injectionPage.field.sessionId': '会话 ID',
    'injectionPage.field.query': '查询',
    'injectionPage.field.files': '文件（逗号分隔，可选）',
    'injectionPage.submit': '预览注入包',
    'injectionPage.computing': '计算中…',
    'injectionPage.meta.bundleId': '包 ID',
    'injectionPage.meta.phase': '阶段',
    'injectionPage.meta.contentHash': '内容哈希',
    'injectionPage.meta.memories': '记忆数',
    'injectionPage.meta.estimatedTokens': '预估 Token',
    'injectionPage.sectionXml': '上下文 XML',
    'injectionPage.empty': '提交表单以预览注入包。',

    'sleepPage.title': '睡眠',
    'sleepPage.subtitle': '整理历史 — 升格、淘汰、合并',
    'sleepPage.dryRun': '试运行',
    'sleepPage.runNow': '立即运行',
    'sleepPage.running': '运行中…',
    'sleepPage.runFailed': '运行失败：',
    'sleepPage.loading': '加载运行记录…',
    'sleepPage.error': '加载失败：',
    'sleepPage.empty': '还没有睡眠周期。点击"立即运行"开始一次。',
    'sleepPage.cycle': '睡眠周期 #',
    'sleepPage.dryRunBadge': '试运行',
    'sleepPage.started': '开始时间：',
    'sleepPage.ended': '结束时间：',
    'sleepPage.edgesCreated': '创建边数：',
    'sleepPage.contradictions': '发现矛盾：',
    'sleepPage.noChanges': '此周期无变更。',
    'sleepPage.promoted': '升格',
    'sleepPage.evicted': '淘汰',
    'sleepPage.merged': '合并',

    'settingsPage.title': '设置',
    'settingsPage.subtitle': '服务端配置与已注册设备',
    'settingsPage.section.server': '服务端',
    'settingsPage.section.devices': '设备',
    'settingsPage.server.host': '主机',
    'settingsPage.server.port': '端口',
    'settingsPage.server.dbPath': '数据库路径',
    'settingsPage.server.embedding': '嵌入提供者',
    'settingsPage.server.llm': '大模型提供者',
    'settingsPage.server.consolidation': '整理',
    'settingsPage.server.authRequired': '认证',
    'settingsPage.server.yes': '是',
    'settingsPage.server.noDevMode': '否（开发模式）',
    'settingsPage.server.disabled': '已禁用',
    'settingsPage.server.every': '每',
    'settingsPage.server.notConfigured': '（未配 key → 已降级 noop）',
    'settingsPage.loading': '加载中…',
    'settingsPage.error': '加载失败：',
    'settingsPage.emptyDevices': '暂无已注册设备。',
    'settingsPage.table.name': '名称',
    'settingsPage.table.type': '类型',
    'settingsPage.table.registered': '注册时间',
    'settingsPage.table.lastSeen': '最后在线',
    'settingsPage.revoke': '吊销',
    'settingsPage.confirmRevoke': '确认吊销设备"{name}"？',
    'settingsPage.registerDevice': '+ 注册设备',
    'settingsPage.dialog.title': '注册新设备',
    'settingsPage.dialog.name': '名称',
    'settingsPage.dialog.type': '类型',
    'settingsPage.dialog.cancel': '取消',
    'settingsPage.dialog.create': '创建',
    'settingsPage.dialog.creating': '创建中…',
    'settingsPage.dialog.created': '设备已创建',
    'settingsPage.dialog.apiKey': 'API 密钥（请立即复制，不再显示）',
    'settingsPage.dialog.copy': '复制',
    'settingsPage.dialog.done': '完成',

    'graphPage.filters': '筛选',
    'graphPage.depth': '深度',
    'graphPage.direction': '方向',
    'graphPage.edgeTypes': '边类型',
    'graphPage.option.both': '双向',
    'graphPage.option.outgoing': '出向',
    'graphPage.option.incoming': '入向',
    'graphPage.loading': '加载关系图…',
    'graphPage.error': '加载失败：',
    'graphPage.empty': '此记忆暂无关系图。',

    'notFound.title': '404',
    'notFound.message': '页面不存在。',
    'notFound.back': '返回仪表盘',
  },
};

// ── Context ─────────────────────────────
interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nCtx | null>(null);

// ── Provider ────────────────────────────
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = localStorage.getItem('memweave-locale');
    return stored === 'zh' ? 'zh' : 'en';
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('memweave-locale', l);
  }, []);

  const t: I18nCtx['t'] = (key, params) => {
    const template = dict[locale]?.[key] ?? dict.en?.[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, k: string) =>
      String(params[k] ?? `{${k}}`)
    );
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

// ── Hook ────────────────────────────────
export function useLocale(): I18nCtx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useLocale() must be used inside <LocaleProvider>');
  return ctx;
}
