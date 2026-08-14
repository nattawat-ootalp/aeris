/** Aeris design tokens (UX/UI Spec §3) — light, calm, environmental-tech (not clinical). */
import type { WatchStatus } from './types';

export const colors = {
  bg: '#F7F8FA',
  surface: '#FFFFFF',
  border: '#E5E7EB',
  divider: '#EEF0F3',
  text: '#1F2937',
  textMuted: '#6B7280',
  primary: '#0EA5A4', // teal — primary action / links
  // status palette (§3.1, §27) — "Normal" is a label, never a medical assurance
  normal: '#16A34A',
  normalBg: '#EAF7EE',
  caution: '#F59E0B',
  cautionBg: '#FEF6E7',
  high: '#DC2626',
  highBg: '#FDECEC',
  unknown: '#9CA3AF',
  unknownBg: '#F1F2F4',
};

export const space = { xs: 4, sm: 8, md: 16, lg: 20, xl: 28 };

export const radius = { sm: 10, md: 14, lg: 16, pill: 20 };

export const type = {
  display: { fontSize: 30, fontWeight: '800' as const },
  h1: { fontSize: 23, fontWeight: '800' as const },
  h2: { fontSize: 19, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  secondary: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
};

export function statusColor(status: WatchStatus): string {
  switch (status) {
    case 'Normal':
      return colors.normal;
    case 'Caution':
      return colors.caution;
    case 'High':
      return colors.high;
    case 'No Data':
      return colors.unknown;
  }
}

export function statusBg(status: WatchStatus): string {
  switch (status) {
    case 'Normal':
      return colors.normalBg;
    case 'Caution':
      return colors.cautionBg;
    case 'High':
      return colors.highBg;
    case 'No Data':
      return colors.unknownBg;
  }
}

// §27 status-system copy: allowed text per status. Never "SAFE" and never diagnostic language.
export const statusCopy: Record<WatchStatus, string> = {
  Normal: 'ไม่พบเงื่อนไขที่ระบบกำหนดให้ต้องระวังเป็นพิเศษ',
  Caution: 'มีข้อมูลสิ่งแวดล้อมที่ควรสังเกต',
  High: 'พบการรับสัมผัสสูงตามเกณฑ์ระบบ',
  'No Data': 'ข้อมูลไม่พอสำหรับการประเมิน',
};
