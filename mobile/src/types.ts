/**
 * Shared types for the Aeris mobile app.
 *
 * The WatchStatus union is the load-bearing medical-safety guard (TDD §7, §14):
 * a status indicator can ONLY ever be one of these four labels. "Safe"/"SAFE" is
 * absent by construction, so it is a *type error* to assign it to a status field.
 */

// ── The only labels a status indicator ("Watch"/badge) may ever show ──
export const WATCH_STATUSES = ['Normal', 'Caution', 'High', 'No Data'] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];

// ── Backend engineering decision states (intelligence/models.py Decision) ──
export type Decision = 'NORMAL' | 'CAUTION' | 'HIGH' | 'NO_DATA';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

/** Explainable decision event (TDD §4.1 / intelligence explain.to_contract). */
export interface DecisionEvent {
  decision: Decision;
  confidence: Confidence;
  reason_codes: string[];
  freshness_sec: number | null;
  sample_size: number;
  watch_label: WatchStatus;
}

/** Latest telemetry for an area/station node (TDD §8 GET /nodes/{id}/telemetry). */
export interface NodeTelemetry {
  node_id: string;
  timestamp: string; // ISO-8601
  pm25: number | null;
  temperature: number | null;
  humidity: number | null;
}

/** Destination assessment result (TDD §6). Never fabricate current values. */
export interface DestinationAssessment {
  destination: string;
  node_id: string | null;
  watch_label: WatchStatus;
  reason_codes: string[];
  distance_km: number | null;
  /** Age of the node's last reading, seconds. null => unknown. */
  last_seen_sec: number | null;
  /** false => node offline / no valid node found => show "unavailable". */
  available: boolean;
  /** true => data too old to use as current => show "stale". */
  stale: boolean;
}

/**
 * Device health — battery/sensor/firmware. Kept structurally SEPARATE from any
 * environmental status (TDD §3.2, §14): this is hardware state, never a caution.
 */
export interface DeviceHealthStatus {
  device_id: string;
  battery_pct: number | null;
  sensor_status: string; // e.g. "OK", "WARMUP", "INVALID"
  fw_version: string;
  rssi: number | null;
  last_seen_sec: number | null;
}

// ── Symptom event — PRIVATE health data (TDD §9). Never leaves the device to any
//    public/shared view. Logged locally in the scaffold. ──
export type SymptomSeverity = 'mild' | 'moderate' | 'severe';

export interface SymptomEventInput {
  symptom: string;
  severity: SymptomSeverity;
  note?: string;
  occurred_at: string; // ISO-8601
}

export interface SymptomEventRecord extends SymptomEventInput {
  id: string;
}

// ── Privacy preferences (TDD §9). Consent-gated; withdrawal supported. ──
export interface PrivacyPrefs {
  syncEnabled: boolean;
  shareAreaContext: boolean;
  consentGiven: boolean;
}
