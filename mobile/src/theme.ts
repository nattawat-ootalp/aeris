/** Shared visual tokens + the status→color map. */
import type { WatchStatus } from './types';

export const colors = {
  bg: '#0b1220',
  surface: '#131c2e',
  border: '#243043',
  text: '#e6edf7',
  textMuted: '#8ea0bd',
  // status palette — deliberately no "safe/green-means-safe" affordance (TDD §7/§14)
  normal: '#3b82f6',
  caution: '#f59e0b',
  high: '#ef4444',
  nodata: '#64748b',
};

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export function statusColor(status: WatchStatus): string {
  switch (status) {
    case 'Normal':
      return colors.normal;
    case 'Caution':
      return colors.caution;
    case 'High':
      return colors.high;
    case 'No Data':
      return colors.nodata;
  }
}
