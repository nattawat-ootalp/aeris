/**
 * Current Environment (TDD §7, MVP): local personal exposure + area context, shown as
 * two clearly separate sections. When data is missing or stale we show "No Data" /
 * a stale note — never a fabricated current value (TDD §5.6, §14).
 */
import { ActivityIndicator } from 'react-native';
import { ageSeconds, api, isStale } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { Card, Muted, Row, Screen } from '../components/ui';
import { DEMO_DEVICE_ID, DEMO_NODE_ID } from '../constants';
import { useAsync } from '../hooks/useAsync';
import { decisionToWatch } from '../safety';
import { colors } from '../theme';
import type { WatchStatus } from '../types';

export function CurrentEnvironmentScreen() {
  const local = useAsync(() => api.currentDecision(DEMO_DEVICE_ID), [DEMO_DEVICE_ID]);
  const area = useAsync(() => api.nodeTelemetry(DEMO_NODE_ID), [DEMO_NODE_ID]);

  return (
    <Screen title="Current Environment" subtitle="Personal exposure and nearby area context.">
      <Card title="Local (your device)" accent={colors.statusNormal}>
        {local.state.status === 'loading' ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : local.state.status === 'error' ? (
          <>
            <StatusBadge status="No Data" size="lg" />
            <Muted>Backend unavailable ({local.state.error}). Showing no current value.</Muted>
          </>
        ) : (
          (() => {
            const ev = local.state.data;
            const stale = isStale(ev.freshness_sec);
            const status: WatchStatus = stale ? 'No Data' : decisionToWatch(ev.decision);
            return (
              <>
                <StatusBadge status={status} size="lg" />
                <Row label="Confidence" value={ev.confidence} />
                <Row label="Freshness" value={ev.freshness_sec == null ? 'unknown' : `${ev.freshness_sec}s ago`} />
                <Row label="Reasons" value={ev.reason_codes.join(', ') || '—'} />
                {stale ? <Muted>Reading is stale — not shown as current.</Muted> : null}
              </>
            );
          })()
        )}
      </Card>

      <Card title="Area (nearest station)" accent={colors.statusCaution}>
        {area.state.status === 'loading' ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : area.state.status === 'error' ? (
          <>
            <StatusBadge status="No Data" size="md" />
            <Muted>Station data unavailable ({area.state.error}).</Muted>
          </>
        ) : (
          (() => {
            const t = area.state.data;
            const age = ageSeconds(t.timestamp);
            const stale = isStale(age);
            return (
              <>
                <StatusBadge status={stale ? 'No Data' : 'Normal'} size="md" />
                <Row label="Node" value={t.node_id} />
                <Row label="PM2.5" value={t.pm25 == null ? '—' : `${t.pm25} µg/m³`} />
                <Row label="Last seen" value={age == null ? 'unknown' : `${age}s ago`} />
                {stale ? <Muted>Station reading is stale/unavailable.</Muted> : null}
              </>
            );
          })()
        )}
      </Card>

      <Muted>Environmental status only. Low concern does not mean medically safe.</Muted>
    </Screen>
  );
}
