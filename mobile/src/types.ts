/**
 * Shared types. The watch/status vocabulary is a CLOSED union (TDD §7/§14): the medical
 * assurance word "Safe" is intentionally absent, so it is impossible to render by construction.
 */
export type WatchStatus = 'Normal' | 'Caution' | 'High' | 'No Data';

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface DecisionEvent {
  decision: 'NORMAL' | 'CAUTION' | 'HIGH' | 'NO_DATA';
  confidence: Confidence;
  reason_codes: string[];
  freshness_sec: number | null;
  sample_size: number;
  watch_label: WatchStatus;
}

export interface DestinationAssessment {
  status: 'ok' | 'stale' | 'unavailable';
  decision: DecisionEvent['decision'];
  watch_label: WatchStatus;
  reason_codes: string[];
  node_code: string | null;
  distance_km: number | null;
  freshness_sec: number | null;
  pm25: number | null;
  trend: string | null;
}

/** Map a backend decision string to the closed watch vocabulary. */
export function toWatchStatus(decision: DecisionEvent['decision']): WatchStatus {
  switch (decision) {
    case 'NORMAL':
      return 'Normal';
    case 'CAUTION':
      return 'Caution';
    case 'HIGH':
      return 'High';
    case 'NO_DATA':
      return 'No Data';
  }
}
