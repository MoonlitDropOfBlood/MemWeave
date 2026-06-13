/** Light formatting helpers used by many components. */

export const formatStrength = (n: number): string => n.toFixed(2);

export const formatDate = (ts: number | null | undefined): string => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString();
};

export const formatRelativeTime = (ts: number | null | undefined): string => {
  if (!ts) return '—';
  const diffMs = Date.now() - ts;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return formatDate(ts);
};

export const formatTokens = (n: number): string =>
  n > 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

export const truncate = (text: string, max: number): string =>
  text.length <= max ? text : text.slice(0, max - 1) + '…';
