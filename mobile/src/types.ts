/**
 * Shared types. The watch/status vocabulary is a CLOSED union (TDD §7/§14, UX §27): the
 * medical assurance word "Safe" is intentionally absent, so it is impossible to render by
 * construction.
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

export interface NodeMarker {
  node_code: string;
  name: string;
  lat: number;
  lon: number;
  pm25: number | null;
  freshness_sec: number | null;
  watch_label: WatchStatus;
}

export interface ExposureTimelineEvent {
  id: string;
  time: string; // ISO
  location: string;
  level: WatchStatus;
  duration_min: number;
  pm25_avg: number | null;
  pm25_max: number | null;
}

export type SymptomType = 'cough' | 'chest_tightness' | 'wheeze' | 'breathless' | 'other';
export type Severity = 'mild' | 'moderate' | 'severe';

export interface SymptomEventInput {
  symptoms: SymptomType[];
  severity: Severity;
  started_at: string; // ISO
  note?: string;
}

export interface PersonalBaseline {
  ready: boolean;
  sample_count: number;
  median: number | null;
  upper: number | null;
  current: number | null;
  updated_at: string | null;
}

export interface PersonalPattern {
  title: string;
  condition: string;
  event_count: number;
  co_occurrence_count: number;
  sample_size: number;
  uncertainty: number | null;
  sufficient: boolean;
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
