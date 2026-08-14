/** Freshness/time formatting used across screens — never hides that data may be old. */
export function freshnessLabel(sec: number | null): string {
  if (sec == null) return 'ไม่ทราบความใหม่ของข้อมูล';
  if (sec < 60) return `Updated ${Math.round(sec)}s ago`;
  if (sec < 3600) return `Updated ${Math.round(sec / 60)} min ago`;
  return `Updated ${Math.round(sec / 3600)} hr ago`;
}

export function isStale(sec: number | null, maxAgeSec = 900): boolean {
  return sec == null || sec > maxAgeSec;
}
