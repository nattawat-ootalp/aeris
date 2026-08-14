/** Aeris design tokens — modern, calm, environmental-tech (UX/UI Spec §3, refreshed). */
import { Platform } from 'react-native';
import type { WatchStatus } from './types';

export const colors = {
  // surfaces
  bg: '#F4F6FB',
  bgTint: '#EEF2F9',
  surface: '#FFFFFF',
  surfaceAlt: '#FBFCFE',
  border: '#EAEDF3',
  divider: '#F0F2F6',

  // text
  text: '#0F172A',
  textMuted: '#64748B',
  textFaint: '#94A3B8',

  // brand
  primary: '#0D9488',
  primaryDark: '#0F766E',
  primarySoft: '#E6F5F3',

  // status (§3.1 / §27) — "Normal" is a label, never a medical assurance
  normal: '#12B76A',
  normalSoft: '#E7F8EF',
  caution: '#F79009',
  cautionSoft: '#FEF4E6',
  high: '#F04438',
  highSoft: '#FDECEA',
  unknown: '#94A3B8',
  unknownSoft: '#EFF2F6',
};

export const space = { xs: 4, sm: 8, md: 16, lg: 20, xl: 28, xxl: 40 };

export const radius = { sm: 12, md: 16, lg: 20, xl: 28, pill: 999 };

export const type = {
  hero: { fontSize: 44, fontWeight: '800' as const, letterSpacing: -1 },
  display: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.5 },
  h1: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.4 },
  h2: { fontSize: 18, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const },
  secondary: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  overline: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1.2 },
};

// Soft, layered elevation (iOS shadow + Android elevation).
export const shadow = Platform.select({
  ios: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 3 },
  default: { boxShadow: '0 6px 16px rgba(15,23,42,0.06)' },
}) as object;

export const shadowSm = Platform.select({
  ios: { shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  android: { elevation: 2 },
  default: { boxShadow: '0 2px 8px rgba(15,23,42,0.05)' },
}) as object;

type StatusVisual = { color: string; soft: string; gradient: [string, string] };

const STATUS: Record<WatchStatus, StatusVisual> = {
  Normal: { color: colors.normal, soft: colors.normalSoft, gradient: ['#12B76A', '#0E9F6E'] },
  Caution: { color: colors.caution, soft: colors.cautionSoft, gradient: ['#F79009', '#E67700'] },
  High: { color: colors.high, soft: colors.highSoft, gradient: ['#F04438', '#D92D20'] },
  'No Data': { color: colors.unknown, soft: colors.unknownSoft, gradient: ['#98A2B3', '#7A8699'] },
};

export function statusColor(status: WatchStatus): string {
  return STATUS[status].color;
}
export function statusBg(status: WatchStatus): string {
  return STATUS[status].soft;
}
export function statusGradient(status: WatchStatus): [string, string] {
  return STATUS[status].gradient;
}

// §27 status-system copy: allowed text per status. Never "SAFE", never diagnostic language.
export const statusCopy: Record<WatchStatus, string> = {
  Normal: 'ไม่พบเงื่อนไขที่ระบบกำหนดให้ต้องระวังเป็นพิเศษ',
  Caution: 'มีข้อมูลสิ่งแวดล้อมที่ควรสังเกต',
  High: 'พบการรับสัมผัสสูงตามเกณฑ์ระบบ',
  'No Data': 'ข้อมูลไม่พอสำหรับการประเมิน',
};
