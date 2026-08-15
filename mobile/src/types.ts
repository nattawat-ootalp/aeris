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
  pm25: number | null;
  temperature: number | null;
  humidity: number | null;
  tvoc: number | null;
  eco2: number | null;
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

/** One contiguous period at the same environmental level, as segmented by the backend
 *  (core_api/app/analytics.py). `id` is the period's start instant, so it stays stable
 *  across refetches of the same window. */
export interface ExposureTimelineEvent {
  id: string;
  start: string; // ISO
  end: string; // ISO
  level: WatchStatus;
  duration_sec: number;
  sample_count: number;
  pm25_avg: number | null;
  pm25_max: number | null;
  pm25_min: number | null;
}

/** A timeline period plus the non-PM context measured during it. Any sensor that had no
 *  valid reading in the period comes back null and must be rendered as "No Data". */
export interface ExposureEventDetail extends ExposureTimelineEvent {
  temperature_avg: number | null;
  humidity_avg: number | null;
  tvoc_avg: number | null;
  eco2_avg: number | null;
  trend: string | null;
}

export interface DailySummary {
  tracked_time: string;
  tracked_sec: number;
  elevated_exposure: string;
  elevated_sec: number;
  high_exposure: string;
  high_sec: number;
  mean_pm25: number | null;
  sample_count: number;
  symptom_events: number;
  highest_exposure_start: string | null;
  highest_exposure_end: string | null;
  highest_exposure_pm25: number | null;
}

export interface WeeklyDay {
  date: string;
  weekday: string;
  mean_pm25: number | null;
  max_pm25: number | null;
  tracked_sec: number;
  elevated_sec: number;
  sample_count: number;
}

export interface WeeklyHistory {
  days: WeeklyDay[];
  highest_day: string | null;
  highest_day_elevated: string | null;
  total_sample_count: number;
}

export interface DataQuality {
  has_data: boolean;
  freshness_sec: number | null;
  fresh?: boolean;
  pm25_valid?: boolean;
  usable?: boolean;
  sensor_status: string | null;
  gaps_last_hour: number | null;
  coverage_ratio_last_hour: number | null;
  sample_count: number;
  battery_low: boolean;
  reasons: string[];
  confidence: Confidence;
  decision_reasons: string[];
}

export interface PrivacySettings {
  sync_enabled: boolean;
  share_environmental: boolean;
  share_symptoms: boolean;
  location_sharing: 'none' | 'coarse' | 'precise';
  retention_days: number;
  consented_at: string | null;
  withdrawn_at: string | null;
}

/** Environmental (not medical) decision boundaries, served by the backend so the client
 *  never keeps its own copy. */
export interface Thresholds {
  pm25_caution: number;
  pm25_high: number;
  freshness_max_age_sec: number;
}

export interface DeviceRecord {
  id: string;
  external_id: string;
  kind: string;
  label: string | null;
  fw_version: string | null;
  last_seen: string | null;
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
  /** Observed proportion (0..1), null when there is nothing to report. */
  association: number | null;
  uncertainty: number | null;
  sufficient: boolean;
  exposure_episode_count: number;
  note: string;
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
