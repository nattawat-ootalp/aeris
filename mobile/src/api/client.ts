/**
 * Typed API client for the Aeris core-api (FastAPI).
 *
 * Design rules baked in (TDD §5.6, §6, §14):
 *  - Every call returns a discriminated {@link ApiResult}; callers render loading /
 *    error / data explicitly. Failures never throw into the UI.
 *  - Endpoints may not exist yet on the backend — a 404/timeout/offline degrades to a
 *    typed error, and screens fall back to "No Data" / "unavailable" rather than
 *    fabricating a current value.
 *  - Staleness is computed from the reading timestamp, not assumed fresh.
 */
import { API_BASE_URL, FRESHNESS_MAX_AGE_SEC, REQUEST_TIMEOUT_MS } from '../config';
import { decisionToWatch, isWatchStatus } from '../safety';
import type {
  DecisionEvent,
  DestinationAssessment,
  DeviceHealthStatus,
  NodeTelemetry,
  SymptomEventInput,
  WatchStatus,
} from '../types';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network error';
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Seconds since an ISO timestamp; null if unparseable. */
export function ageSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

/** A reading is stale when older than the freshness contract (TDD §5.6). */
export function isStale(ageSec: number | null): boolean {
  return ageSec === null || ageSec > FRESHNESS_MAX_AGE_SEC;
}

export const api = {
  /** GET /health — liveness probe. */
  health(): Promise<ApiResult<{ status: string }>> {
    return request('/health');
  },

  /**
   * Current decision for the user's portable device. Backend returns the §4.1 shape;
   * we normalize watch_label defensively so a bad/absent value becomes "No Data".
   */
  async currentDecision(deviceId: string): Promise<ApiResult<DecisionEvent>> {
    const res = await request<DecisionEvent>(`/devices/${encodeURIComponent(deviceId)}/decision`);
    if (!res.ok) return res;
    const raw = res.data;
    const watch_label: WatchStatus = isWatchStatus(raw.watch_label)
      ? raw.watch_label
      : decisionToWatch(raw.decision);
    return { ok: true, data: { ...raw, watch_label } };
  },

  /** GET /nodes/{id}/telemetry — latest area/station reading. */
  nodeTelemetry(nodeId: string): Promise<ApiResult<NodeTelemetry>> {
    return request(`/nodes/${encodeURIComponent(nodeId)}/telemetry`);
  },

  /** Destination assessment (TDD §6). */
  assessDestination(destination: string): Promise<ApiResult<DestinationAssessment>> {
    return request(`/destination?q=${encodeURIComponent(destination)}`);
  },

  /** GET /devices/{id}/health — battery/sensor/firmware (device domain only). */
  deviceHealth(deviceId: string): Promise<ApiResult<DeviceHealthStatus>> {
    return request(`/devices/${encodeURIComponent(deviceId)}/health`);
  },

  /**
   * POST a symptom event. PRIVATE health data (TDD §9) — sent only to the user's own
   * record over the authenticated API, never to any public/shared endpoint.
   */
  logSymptom(deviceId: string, event: SymptomEventInput): Promise<ApiResult<{ id: string }>> {
    return request(`/devices/${encodeURIComponent(deviceId)}/symptom-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  },
};
