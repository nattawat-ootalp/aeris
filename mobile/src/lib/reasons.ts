/**
 * Reason codes as sentences a person can act on.
 *
 * The decision contract carries machine codes — ENV_NORMAL, BASELINE_INSUFFICIENT_SAMPLE — and
 * the app used to print them with the underscores swapped for spaces. That is the engine's
 * vocabulary, not an explanation: "baseline insufficient sample" tells a reader neither what a
 * baseline is, nor that it is a count that will fill up on its own.
 *
 * Where a code refers to a number the user can see moving, the sentence carries it: how far
 * the baseline has got, which boundary the reading is under. The numbers come from the
 * backend's own config (`/config/thresholds`), never from a copy kept here — a client that
 * invented a threshold would eventually disagree with the decision it is explaining.
 */
import type { Thresholds } from '../types';

export interface ReasonContext {
  thresholds: Thresholds | null;
  /** `sample_size` from the decision — for the decision endpoint this is the baseline's count. */
  sampleSize?: number | null;
  pm25?: number | null;
}

/** A short title plus, where it helps, the figure behind it. */
export function reasonText(code: string, ctx: ReasonContext = { thresholds: null }): string {
  const t = ctx.thresholds;
  switch (code) {
    case 'ENV_NORMAL':
      return t
        ? `อากาศอยู่ระดับปกติ — PM2.5 ต่ำกว่าเกณฑ์เฝ้าระวัง ${t.pm25_caution} µg/m³`
        : 'อากาศอยู่ระดับปกติ';
    case 'PM25_ABOVE_ENV_CAUTION':
      return t
        ? `PM2.5 สูงกว่าเกณฑ์เฝ้าระวัง ${t.pm25_caution} µg/m³`
        : 'PM2.5 สูงกว่าเกณฑ์เฝ้าระวัง';
    case 'PM25_ABOVE_ENV_HIGH':
      return t ? `PM2.5 สูงกว่าเกณฑ์สูง ${t.pm25_high} µg/m³` : 'PM2.5 อยู่ในระดับสูง';
    case 'BASELINE_INSUFFICIENT_SAMPLE': {
      const have = ctx.sampleSize ?? 0;
      const need = t?.baseline_min_samples;
      // The point of the sentence: this is not an error, it is a counter that fills as the
      // device records. Saying "3 จาก 50" makes that visible; the bare code did not.
      return need
        ? `ยังไม่ได้เทียบกับค่าปกติของคุณเอง — เก็บข้อมูลได้ ${have} จาก ${need} ตัวอย่างที่ต้องใช้`
        : `ยังไม่ได้เทียบกับค่าปกติของคุณเอง — เก็บข้อมูลได้ ${have} ตัวอย่าง`;
    }
    case 'PM25_ABOVE_PERSONAL_BASELINE':
      return 'สูงกว่าค่าปกติของคุณเองที่ระบบเรียนรู้ไว้';
    case 'PERSONAL_EXPOSURE_ELEVATED':
      return 'การรับสัมผัสของคุณสูงกว่าปกติของคุณเอง';
    case 'EXPOSURE_DURATION_INCREASING':
      return 'อยู่ในอากาศระดับนี้นานขึ้นกว่าช่วงก่อนหน้า';
    case 'SPIKE_SUSPECTED':
      return 'ค่ากระโดดเร็วผิดปกติ — รอดูว่าค่าคงอยู่จริงไหมก่อนสรุป';
    case 'SENSOR_WARMUP':
      return 'เซนเซอร์กำลังอุ่นเครื่อง';
    case 'SENSOR_INVALID':
      return 'เซนเซอร์ฝุ่นอ่านค่าไม่ได้';
    case 'DATA_STALE':
      return t
        ? `ข้อมูลล่าสุดเก่ากว่า ${Math.round(t.freshness_max_age_sec)} วินาที จึงไม่ถือว่าเป็นค่าปัจจุบัน`
        : 'ข้อมูลล่าสุดเก่าเกินกว่าจะถือเป็นค่าปัจจุบัน';
    case 'NO_VALID_DATA':
      return 'ยังไม่มีค่าที่ผ่านเกณฑ์คุณภาพให้ประเมิน';
    default:
      // An unknown code still says something rather than nothing — the engine may ship a new
      // one before this table catches up, and a blank line would hide it.
      return code.replaceAll('_', ' ').toLowerCase();
  }
}
