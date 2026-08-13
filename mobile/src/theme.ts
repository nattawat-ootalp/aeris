/**
 * Design tokens. Note the deliberately SEPARATE accent families so that
 * environmental status, device health, and private/medical content never read as
 * the same kind of signal (TDD §14: keep those three domains visually distinct).
 */
import type { WatchStatus } from './types';

export const colors = {
  bg: '#0f1419',
  surface: '#1a222b',
  surfaceAlt: '#222c37',
  border: '#2c3945',
  text: '#e6edf3',
  textMuted: '#93a1ac',

  // Environmental status accents (the Watch labels)
  statusNormal: '#2ea043',
  statusCaution: '#d29922',
  statusHigh: '#e5534b',
  statusNoData: '#6e7681',

  // Device-health domain accent (cool/technical, distinct from status)
  device: '#4b8bd6',

  // Private / medical domain accent (distinct again; signals "private")
  privacy: '#a371f7',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 6, md: 10, lg: 14 };

export function statusColor(status: WatchStatus): string {
  switch (status) {
    case 'Normal':
      return colors.statusNormal;
    case 'Caution':
      return colors.statusCaution;
    case 'High':
      return colors.statusHigh;
    case 'No Data':
    default:
      return colors.statusNoData;
  }
}
