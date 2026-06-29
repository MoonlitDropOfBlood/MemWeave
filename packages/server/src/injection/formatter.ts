import type { MemoryRecord } from '../core/types.js';

export type MemoryForFormat = Pick<MemoryRecord, 'id' | 'type' | 'tier' | 'strength' | 'importance' | 'title' | 'summary'>;

export interface ProfileForFormat {
  userKey: string;
  traits: string[];
  summary: string;
}

export function formatMemoriesAsXml(phase: string, memories: MemoryForFormat[], profile?: ProfileForFormat | null): string {
  const sorted = [...memories].sort((a, b) => {
    const tierOrder = { long: 0, medium: 1, short: 2 };
    const aOrder = tierOrder[a.tier] ?? 2;
    const bOrder = tierOrder[b.tier] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return b.strength * b.importance - a.strength * a.importance;
  });

  const header = `<memory-context phase="${escapeAttr(phase)}" count="${sorted.length}">`;
  const items = sorted.map(m =>
    `  <memory id="${escapeAttr(m.id)}" type="${escapeAttr(m.type)}" tier="${escapeAttr(m.tier)}" strength="${m.strength.toFixed(2)}" importance="${m.importance}">\n` +
    `    <title>${escapeText(m.title)}</title>\n` +
    `    <summary>${escapeText(m.summary)}</summary>\n` +
    `  </memory>`
  );
  const footer = `</memory-context>`;

  // The <about-user> section (batch F): prepended so the agent always knows
  // who it's talking to before reading any memories. Omitted entirely when
  // no profile exists (returns null/undefined), so the bundle shape stays
  // backward-compatible for users who never set a profile.
  const aboutUser = formatAboutUser(profile);
  return [aboutUser, header, ...items, footer].filter(Boolean).join('\n');
}

/** Render the <about-user> section, or return '' when the profile is absent/empty. */
export function formatAboutUser(profile?: ProfileForFormat | null): string {
  if (!profile) return '';
  const hasTraits = profile.traits.length > 0;
  const hasSummary = profile.summary.trim().length > 0;
  if (!hasTraits && !hasSummary) return '';
  const header = `<about-user key="${escapeAttr(profile.userKey)}">`;
  const parts: string[] = [];
  if (hasSummary) parts.push(`  <summary>${escapeText(profile.summary)}</summary>`);
  if (hasTraits) parts.push(`  <traits>${profile.traits.map(escapeText).join(', ')}</traits>`);
  const footer = `</about-user>`;
  return [header, ...parts, footer].join('\n');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
