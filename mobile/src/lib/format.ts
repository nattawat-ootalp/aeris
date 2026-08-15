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

/** TVOC/eCO2 are OMITTED by the device while the VOC sensor warms up (15s) or is invalid —
 *  `undefined` means no data. Render honestly as "No Data", never 0 and never a stale value. */
export function tvocLabel(ppb: number | undefined): string {
  return ppb == null ? 'No Data' : `${Math.round(ppb)} ppb`;
}

/** eCO2 is ESTIMATED from VOC sensing, not a direct CO2 measurement — callers must keep it
 *  labeled "(estimated)" wherever it is shown. Same no-data rule as tvocLabel. */
export function eco2Label(ppm: number | undefined | null): string {
  return ppm == null ? 'No Data' : `${Math.round(ppm)} ppm`;
}

/** Elapsed/covered time. Mirrors the backend's format_duration so both sides read alike. */
export function durationLabel(sec: number | null | undefined): string {
  if (sec == null) return 'No Data';
  const minutes = Math.floor(sec / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Clock time of an ISO instant; "--" when the instant is absent (never a stand-in time). */
export function clockLabel(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** A measured value with its unit, or "No Data" when the sensor had nothing valid. */
export function valueLabel(value: number | null | undefined, unit: string, digits = 0): string {
  return value == null ? 'No Data' : `${value.toFixed(digits)} ${unit}`;
}
