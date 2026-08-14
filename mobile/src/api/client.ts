/**
 * Typed Aeris API client. Base URL is env-configurable; defaults to local dev.
 * Callers must handle the "unavailable"/"No Data" shapes explicitly — the client never
 * fabricates a current value when data is missing or stale (TDD §6/§14).
 */
import { ensureSessionToken } from '../lib/supabase';
import type { DecisionEvent, DestinationAssessment, NodeMarker, SymptomEventInput } from '../types';

export const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function postJsonAuthed<T>(path: string, body: unknown): Promise<T> {
  const token = await ensureSessionToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
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

export async function getRanking(topN = 8): Promise<{ ranking: NodeMarker[] }> {
  return getJson(`/dashboard/ranking?top_n=${topN}`);
}

export async function logSymptom(input: SymptomEventInput): Promise<{ stored: boolean }> {
  return postJsonAuthed('/symptoms', input);
}

export async function ingestPortable(payload: {
  device_id: string;
  timestamp: string;
  pm25?: number;
  temperature?: number;
  humidity?: number;
  battery?: number;
  sensor_status?: string;
  quality_score?: number;
}): Promise<{ accepted: boolean }> {
  const res = await fetch(`${BASE_URL}/ingest/portable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST /ingest/portable -> ${res.status}`);
  return (await res.json()) as { accepted: boolean };
}
