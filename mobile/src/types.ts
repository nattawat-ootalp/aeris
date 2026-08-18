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
  /** TRUE CO2 measured by the SCD40 (NDIR), ppm. */
  co2: number | null;
  eco2: number | null;
  /** ISO time the reading was actually taken, or null when there is no reading. */
  measured_at: string | null;
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
  // Context from the same frame, sent only with an 'ok' status. The watch label is decided by
  // PM2.5 alone, so these must never be rendered as if they set it.
  pm10: number | null;
  co2: number | null;
  tvoc: number | null;
  temperature: number | null;
  humidity: number | null;
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
  co2_avg: number | null;
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
  /** The user reporting they used their inhaler. Diary context only — the app never advises
   *  for or against using it. */
  inhaler_used?: boolean;
}

/** Systemic risk indicator (§5.9). `score` is null whenever `decision` is 'NO_DATA' — there
 *  is no zero for "unknown", because a zero reads as a reassurance the system cannot give. */
export interface RiskScore {
  device_id: string;
  score: number | null;
  decision: DecisionEvent['decision'];
  watch_label: WatchStatus;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  reason_codes: string[];
  sample_size: number;
  components: Record<string, number>;
  freshness_sec: number | null;
  note: string;
}

/** Short-horizon projection of environmental PM2.5 (§5.10). Never a symptom prediction. */
export interface Forecast {
  device_id: string;
  available: boolean;
  horizon_sec: number;
  projected_pm25: number | null;
  uncertainty: number | null;
  trend_per_hour: number | null;
  decision: DecisionEvent['decision'];
  watch_label: WatchStatus;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  reason_codes: string[];
  sample_size: number;
  note: string;
}

/** The care plan the user or their clinician wrote. Aeris stores and displays it and never
 *  authors, reorders or completes a step. */
export interface ActionPlan {
  exists: boolean;
  author: 'user' | 'clinician';
  clinician_name: string | null;
  reviewed_at: string | null;
  normal_steps: string[];
  caution_steps: string[];
  high_steps: string[];
  emergency_steps: string[];
  notes: string | null;
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string | null;
  relationship: string | null;
  notify_on_sos: boolean;
  sort_order: number;
}

export interface SosEvent {
  id?: string;
  source: 'app' | 'portable';
  occurred_at: string;
  lat: number | null;
  lon: number | null;
  pm25?: number | null;
  notified_contacts: number;
}

export interface SosResult {
  recorded: boolean;
  event: SosEvent;
  location_stored: boolean;
  location_sharing: 'none' | 'coarse' | 'precise';
  contacts: EmergencyContact[];
  action_plan: ActionPlan;
  note: string;
}

export interface PersonalBaseline {
  ready: boolean;
  sample_count: number;
  /** Readings the engine requires before it will personalize at all. Comes from the backend
   *  because it is configurable there; copying the number here would go stale on the first
   *  tuning change and the app would misreport progress. */
  min_samples: number;
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

// ── §3 Route Exposure Simulator ─────────────────────────────────────────────────────────

export interface ParameterSummary {
  parameter: string;
  unit: string;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  sample_count: number;
  /** Sigma(C x dt) in <unit>-minutes. Environmental exposure, never an inhaled dose. */
  exposure_integral: number | null;
  exposure_unit: string | null;
  time_above_threshold_s: number | null;
  threshold: number | null;
  covered_s: number;
}

export interface RoutePoint {
  index: number;
  lat: number;
  lon: number;
  distance_m: number;
  time: string;
  /** Null where no station was within max_sensor_distance_m — the gap is kept, not filled. */
  sensor: string | null;
  sensor_distance_m: number | null;
  values: Record<string, number>;
}

export interface SimulationResult {
  distance_m: number;
  duration_s: number;
  /** 0..1 — route points that resolved to a reading (§3.11). */
  coverage: number;
  route: {
    provider: string;
    profile: string;
    distance_m: number;
    provider_duration_s: number | null;
    note: string | null;
  };
  travel_mode: string;
  speed_mps: number;
  start_time: string;
  sensors_used: string[];
  sensors_considered: string[];
  results: Record<string, ParameterSummary>;
  points: RoutePoint[];
  disclaimer: string;
}

export interface SimulatorConfig {
  parameters: Record<string, { unit: string }>;
  default_thresholds: Record<string, number>;
  travel_modes: Record<string, { default_speed_mps: number; profile: string }>;
  interpolation_modes: string[];
  defaults: { sampling_distance_m: number; max_sensor_distance_m: number; max_gap_s: number };
  stations: { node_code: string; name: string; lat: number; lon: number }[];
}

export interface SimulateInput {
  start: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  start_time: string;
  travel_mode: string;
  speed_mps?: number;
  sampling_distance_m?: number;
  max_sensor_distance_m?: number;
  parameters: string[];
  interpolation?: string;
  label?: string;
}

// ── §4 Air Quality Time Machine ─────────────────────────────────────────────────────────

/** One instant, every station that recorded in it. A station absent from `stations` recorded
 *  nothing in that window — it is never carried forward from the previous frame. */
export interface ReplayFrame {
  timestamp: string;
  stations: Record<string, Record<string, number>>;
}

export interface ReplayData {
  start: string;
  end: string;
  interval: string;
  /** True when the server used a coarser interval than asked, to keep the payload bounded. */
  interval_coarsened: boolean;
  requested_interval: string | null;
  station_ids: string[];
  parameters: Record<string, { unit: string }>;
  frame_count: number;
  frames: ReplayFrame[];
  stats: Record<string, Record<string, {
    minimum: number; maximum: number; average: number; samples: number; unit: string;
  }>>;
  stations_with_data: string[];
}

export interface ReplayStation {
  node_code: string;
  name: string;
  lat: number;
  lon: number;
  active: boolean;
  last_seen: string | null;
}

export interface ReplayStations {
  stations: ReplayStation[];
  intervals: string[];
  parameters: Record<string, { unit: string }>;
  max_frames: number;
  max_span_days: number;
}

export interface CompareRow {
  station_id: string;
  value_a: number | null;
  value_b: number | null;
  difference: number | null;
  percent_change: number | null;
  status: 'ok' | 'no_data';
}

export interface CompareResult {
  parameter: string;
  unit: string;
  time_a: string;
  time_b: string;
  window_s: number;
  rows: CompareRow[];
}

export interface ReplayBookmark {
  id: string;
  timestamp: string;
  station_id: string | null;
  parameter: string | null;
  title: string;
  note: string | null;
  created_at: string;
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
