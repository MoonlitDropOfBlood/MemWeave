import type { InjectResponse } from './client.js';

export type MemoryForInjection = Pick<InjectResponse, never> extends never
  ? never
  : {
      id: string;
      type: string;
      tier: 'short' | 'medium' | 'long';
      strength: number;
      importance: number;
      title: string;
      summary: string;
    };

export function buildSystemAppend(phase: string, memories: MemoryForInjection[]): string {
  if (memories.length === 0) return '';

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
  return [header, ...items, footer].join('\n');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}