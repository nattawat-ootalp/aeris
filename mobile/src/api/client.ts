/**
 * Typed Aeris API client. Base URL is env-configurable; defaults to local dev.
 * Callers must handle the "unavailable"/"No Data" shapes explicitly — the client never
 * fabricates a current value when data is missing or stale (TDD §6/§14).
 */
import type { DecisionEvent, DestinationAssessment } from '../types';

const BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_BASE_URL) ||
  'http://localhost:8000';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function getHealth(): Promise<{ status: string }> {
  return getJson('/health');
}

export async function getDeviceDecision(deviceId: string): Promise<DecisionEvent> {
  return getJson(`/devices/${encodeURIComponent(deviceId)}/decision`);
}

export async function assessDestination(
  lat: number,
  lon: number,
): Promise<DestinationAssessment> {
  return getJson(`/destination/assess?lat=${lat}&lon=${lon}`);
}

export async function logSymptom(
  token: string,
  body: { severity: string; note?: string },
): Promise<{ stored: boolean }> {
  const res = await fetch(`${BASE_URL}/symptoms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /symptoms -> ${res.status}`);
  return (await res.json()) as { stored: boolean };
}

export { BASE_URL };
