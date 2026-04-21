// Small formatting helpers shared across admin pages. Kept pure so they are
// trivially testable and reusable.

export function fmtUsdc(n: number, dp = 6): string {
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(dp);
}

export function fmtMultiplier(n: number): string {
  if (!Number.isFinite(n)) return '--';
  return `${n.toFixed(3)}x`;
}

export function fmtPct(n: number, dp = 1): string {
  if (!Number.isFinite(n)) return '--';
  return `${n.toFixed(dp)}%`;
}

export function fmtMs(n: number): string {
  if (!Number.isFinite(n)) return '--';
  return `${n.toFixed(0)}ms`;
}

export function fmtTs(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace('T', ' ').replace(/\..+$/, '');
  } catch {
    return iso;
  }
}

export function shortHash(s: string, head = 6, tail = 4): string {
  if (!s) return '';
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}...${s.slice(-tail)}`;
}
