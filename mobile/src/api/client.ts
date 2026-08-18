/**
 * Typed Aeris API client. Base URL is env-configurable; defaults to local dev.
 * Callers must handle the "unavailable"/"No Data" shapes explicitly — the client never
 * fabricates a current value when data is missing or stale (TDD §6/§14).
 */
import { ensureSessionToken } from '../lib/supabase';
import type {
  ActionPlan,
  DailySummary,
  DataQuality,
  DecisionEvent,
  DestinationAssessment,
  DeviceRecord,
  ExposureEventDetail,
  EmergencyContact,
  ExposureTimelineEvent,
  Forecast,
  NodeMarker,
  PersonalBaseline,
  PersonalPattern,
  PrivacySettings,
  RiskScore,
  SosEvent,
  SosResult,
  SymptomEventInput,
  Thresholds,
  WeeklyHistory,
} from '../types';

export const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000';

/** An HTTP failure that keeps its status, so callers can tell "you are not signed in" (401)
 *  apart from "the server is down" — the two are indistinguishable in a plain message and
 *  lead the user to completely different fixes. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }

  /** No usable session: either sign-in never happened or the backend rejected the token. */
  get unauthenticated(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new ApiError(res.status, `GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function getJsonAuthed<T>(path: string): Promise<T> {
  const token = await ensureSessionToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new ApiError(res.status, `GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function sendJsonAuthed<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  const token = await ensureSessionToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `${method} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function postJsonAuthed<T>(path: string, body: unknown): Promise<T> {
  return sendJsonAuthed('POST', path, body);
}

async function deleteAuthed<T>(path: string): Promise<T> {
  const token = await ensureSessionToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new ApiError(res.status, `DELETE ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function getHealth(): Promise<{ status: string }> {
  return getJson('/health');
}

export async function getDeviceDecision(deviceId: string): Promise<DecisionEvent> {
  return getJson(`/devices/${encodeURIComponent(deviceId)}/decision`);
}

export async function assessDestination(lat: number, lon: number): Promise<DestinationAssessment> {
  return getJson(`/destination/assess?lat=${lat}&lon=${lon}`);
}

export async function getNodeTelemetry(deviceId: string): Promise<Record<string, unknown>> {
  return getJson(`/nodes/${encodeURIComponent(deviceId)}/telemetry`);
}

export async function getNodeHistory(deviceId: string, hours = 24): Promise<{ points: Record<string, unknown>[] }> {
  return getJson(`/nodes/${encodeURIComponent(deviceId)}/history?hours=${hours}`);
}

export async function getThresholds(): Promise<Thresholds> {
  return getJson('/config/thresholds');
}

export async function getRanking(topN = 8): Promise<{ ranking: NodeMarker[] }> {
  return getJson(`/dashboard/ranking?top_n=${topN}`);
}

export interface AlertEvent {
  node_id: string;
  sensor: string;
  value: number;
  threshold: number;
  standard?: string;
  severity: string;
  is_anomaly?: boolean;
  timestamp?: string;
  triggered_at?: string;
}

export async function getAlerts(limit = 50): Promise<{ alerts: AlertEvent[] }> {
  return getJson(`/alerts?limit=${limit}`);
}

export async function logSymptom(input: SymptomEventInput): Promise<{ stored: boolean }> {
  return postJsonAuthed('/symptoms', input);
}

/** One telemetry sample on its way to the backend. `timestamp` is when the reading was
 *  CAPTURED, not when it is being uploaded — the two differ whenever a sample was buffered,
 *  and the backend stores the reading at exactly this time (see src/lib/deviceClock.ts). */
export interface PortableIngestPayload {
  device_id: string;
  timestamp: string;
  pm25?: number;
  temperature?: number;
  humidity?: number;
  /** ppm, a TRUE CO2 measurement from the SCD40. Omit when that sensor has no reading. */
  co2?: number;
  /** ppb. Omit (leave undefined) when the SGP30 has no reading — never send 0/null as a stand-in. */
  tvoc?: number;
  /** ppm, ESTIMATED from VOC sensing (not a direct CO2 measurement). Same omit-when-absent rule as tvoc. */
  eco2?: number;
  battery?: number;
  sensor_status?: string;
  quality_score?: number;
}

export async function ingestPortable(payload: PortableIngestPayload): Promise<{ accepted: boolean }> {
  const res = await fetch(`${BASE_URL}/ingest/portable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new ApiError(res.status, `POST /ingest/portable -> ${res.status}`);
  return (await res.json()) as { accepted: boolean };
}

/** An entry the backend could not store. `retryable` false means it never will be (a sample
 *  whose device clock had not synced, say) — the caller must drop it rather than queue it
 *  forever behind everything else. */
export interface PortableBatchFailure {
  index: number;
  error: string;
  retryable: boolean;
}

export interface PortableBatchResult {
  accepted: boolean;
  received: number;
  stored: number;
  failed: PortableBatchFailure[];
}

/** Replay buffered readings in one request. Idempotent by capture timestamp, so a caller that
 *  never saw the response may safely re-send the same entries. */
export async function ingestPortableBatch(
  readings: PortableIngestPayload[],
): Promise<PortableBatchResult> {
  const res = await fetch(`${BASE_URL}/ingest/portable/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readings }),
  });
  if (!res.ok) throw new ApiError(res.status, `POST /ingest/portable/batch -> ${res.status}`);
  return (await res.json()) as PortableBatchResult;
}

const dev = (deviceId: string) => `/devices/${encodeURIComponent(deviceId)}`;

export async function getDailySummary(deviceId: string): Promise<DailySummary> {
  return getJsonAuthed(`${dev(deviceId)}/daily-summary`);
}

export async function getExposureTimeline(
  deviceId: string,
  hours = 24,
): Promise<{ events: ExposureTimelineEvent[] }> {
  return getJson(`${dev(deviceId)}/exposure-timeline?hours=${hours}`);
}

export async function getExposureEvent(
  deviceId: string,
  eventId: string,
  hours = 24,
): Promise<ExposureEventDetail> {
  return getJson(`${dev(deviceId)}/exposure-timeline/${encodeURIComponent(eventId)}?hours=${hours}`);
}

export async function getWeeklyHistory(deviceId: string, days = 7): Promise<WeeklyHistory> {
  return getJson(`${dev(deviceId)}/weekly?days=${days}`);
}

export async function getDataQuality(deviceId: string): Promise<DataQuality> {
  return getJson(`${dev(deviceId)}/data-quality`);
}

export async function getPersonalBaseline(deviceId: string): Promise<PersonalBaseline> {
  return getJsonAuthed(`${dev(deviceId)}/baseline`);
}

export async function getPersonalPattern(deviceId: string, days = 30): Promise<PersonalPattern> {
  return getJsonAuthed(`${dev(deviceId)}/pattern?days=${days}`);
}

// ── Privacy / data rights ──
export async function getPrivacy(): Promise<PrivacySettings> {
  return getJsonAuthed('/privacy');
}

export async function updatePrivacy(changes: Partial<PrivacySettings>): Promise<PrivacySettings> {
  return sendJsonAuthed('PUT', '/privacy', changes);
}

export async function exportMyData(): Promise<{ exported_at: string; user_id: string; data: Record<string, unknown[]> }> {
  return getJsonAuthed('/privacy/export');
}

export async function withdrawMyData(): Promise<{ withdrawn: boolean; deleted: Record<string, number> }> {
  return postJsonAuthed('/privacy/withdraw', {});
}

// ── Device registry ──
export async function getMyDevices(): Promise<{ devices: DeviceRecord[] }> {
  return getJsonAuthed('/me/devices');
}

export async function registerDevice(device: {
  external_id: string;
  kind?: 'portable' | 'station';
  label?: string;
  fw_version?: string;
}): Promise<{ registered: boolean; device: DeviceRecord | null }> {
  return postJsonAuthed('/me/devices', device);
}

// ── Personalized risk + predictive alert ──
/** Reads private symptom history, so this call is authenticated. A NO_DATA answer carries a
 *  null score — never render a missing measurement as a low one. */
export async function getRisk(deviceId: string, hours = 6): Promise<RiskScore> {
  return getJsonAuthed(`${dev(deviceId)}/risk?hours=${hours}`);
}

/** Environmental projection only; contains no health data, so it needs no auth. */
export async function getForecast(deviceId: string, horizonMin = 20): Promise<Forecast> {
  return getJson(`${dev(deviceId)}/forecast?horizon_min=${horizonMin}`);
}

// ── Asthma action plan (user/clinician authored) ──
export async function getActionPlan(): Promise<ActionPlan> {
  return getJsonAuthed('/me/action-plan');
}

export async function saveActionPlan(plan: Partial<ActionPlan>): Promise<ActionPlan> {
  return sendJsonAuthed('PUT', '/me/action-plan', plan);
}

// ── Emergency contacts ──
export async function getContacts(): Promise<{ contacts: EmergencyContact[] }> {
  return getJsonAuthed('/me/contacts');
}

export async function addContact(contact: {
  name: string;
  phone?: string;
  relationship?: string;
  notify_on_sos?: boolean;
}): Promise<{ added: boolean; contact: EmergencyContact | null }> {
  return postJsonAuthed('/me/contacts', contact);
}

export async function deleteContact(id: string): Promise<{ deleted: boolean }> {
  return deleteAuthed(`/me/contacts/${encodeURIComponent(id)}`);
}

// ── SOS ──
/** Record an SOS the user raised. Coordinates are passed only when the caller already has
 *  them; the backend still re-applies the user's location-consent setting before storing. */
export async function raiseSos(input: {
  source?: 'app' | 'portable';
  device_id?: string;
  occurred_at?: string;
  lat?: number;
  lon?: number;
  location_accuracy_m?: number;
  note?: string;
}): Promise<SosResult> {
  return postJsonAuthed('/sos', input);
}

export async function getSosEvents(limit = 20): Promise<{ events: SosEvent[] }> {
  return getJsonAuthed(`/me/sos?limit=${limit}`);
}
