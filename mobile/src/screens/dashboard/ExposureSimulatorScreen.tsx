/**
 * §3 Route Exposure Simulator — set up a walk, see what the stations along it were reading.
 *
 * Web dashboard only (registered from DashboardStack, which MainTabs mounts on web). The
 * form is wide and the results are three panels side by side; neither works on a phone, and
 * the phone app already has the screens it needs.
 *
 * Everything the API refuses to answer is shown as refused. A route point with no station in
 * range is a gap in the strip and a lower coverage figure, never a value borrowed from the
 * nearest reading, and the "not a dose" boundary is printed under the numbers rather than
 * left in the docs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, getSimulatorConfig, saveSimulation, simulateExposure } from '../../api/client';
import { BandLegend, HeatStrip, SeriesChart, bandColor } from '../../components/charts';
import { RouteMap, type RouteSegment } from '../../components/RouteMap';
import { Chip, ErrorState, InfoCard, LoadingState, MetaRow, PrimaryButton, SecondaryButton, SectionLabel } from '../../components/ui';
import { useMeasureStyle } from '../../lib/responsive';
import { colors, radius, space, type } from '../../theme';
import type { SimulateInput, SimulationResult, SimulatorConfig } from '../../types';

const PARAMETER_CHOICES = ['pm25', 'co2', 'tvoc', 'temperature', 'humidity'] as const;
const TRAVEL_MODES = ['walking', 'cycling', 'driving'] as const;

/** Bands for the strip and the chart. `high` is twice caution, matching the app's own
 *  Normal/Caution/High spacing (pm25 37.5 / 75) so one number is not banded two ways. */
function bands(threshold: number | null): { caution: number; high: number } {
  const caution = threshold ?? 0;
  return { caution, high: caution * 2 };
}

function fmt(v: number | null | undefined, digits = 1): string {
  return v == null ? 'No Data' : v.toFixed(digits);
}

function minutes(seconds: number | null | undefined): string {
  if (seconds == null) return 'No Data';
  const m = Math.round(seconds / 60);
  return m < 1 ? '< 1 min' : `${m} min`;
}

function Field({
  label,
  value,
  onChange,
  hint,
  width = 150,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  width?: number;
}) {
  return (
    <View style={{ width }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange} placeholder={hint}
                 placeholderTextColor={colors.textFaint} />
    </View>
  );
}

export function ExposureSimulatorScreen() {
  const measure = useMeasureStyle();
  const [config, setConfig] = useState<SimulatorConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [startLat, setStartLat] = useState('12.2395');
  const [startLng, setStartLng] = useState('102.5098');
  const [destLat, setDestLat] = useState('12.2489');
  const [destLng, setDestLng] = useState('102.5221');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('07:30');
  const [mode, setMode] = useState<string>('walking');
  const [speed, setSpeed] = useState('');
  const [spacing, setSpacing] = useState('50');
  const [maxSensor, setMaxSensor] = useState('300');
  const [params, setParams] = useState<string[]>(['pm25', 'co2', 'tvoc']);

  const [result, setResult] = useState<SimulationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  useEffect(() => {
    getSimulatorConfig()
      .then(setConfig)
      .catch((e) => setConfigError(String(e)));
  }, []);

  const input: SimulateInput | null = useMemo(() => {
    const nums = [startLat, startLng, destLat, destLng].map(Number);
    if (nums.some((n) => Number.isNaN(n))) return null;
    // Times are entered in local wall-clock and sent with the browser's offset, so "07:30"
    // means half past seven where the user is rather than in UTC.
    const localIso = new Date(`${date}T${time}:00`);
    if (Number.isNaN(localIso.getTime())) return null;
    return {
      start: { lat: nums[0], lng: nums[1] },
      destination: { lat: nums[2], lng: nums[3] },
      start_time: localIso.toISOString(),
      travel_mode: mode,
      speed_mps: speed ? Number(speed) : undefined,
      sampling_distance_m: Number(spacing) || 50,
      max_sensor_distance_m: Number(maxSensor) || 300,
      parameters: params,
    };
  }, [startLat, startLng, destLat, destLng, date, time, mode, speed, spacing, maxSensor, params]);

  const run = useCallback(async () => {
    if (!input) {
      setError('Check the coordinates, date and time — one of them is not a number.');
      return;
    }
    if (!params.length) {
      setError('Choose at least one parameter to analyse.');
      return;
    }
    setRunning(true);
    setError(null);
    setSaveNote(null);
    try {
      setResult(await simulateExposure(input));
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? `Simulation failed (HTTP ${e.status})` : String(e));
    } finally {
      setRunning(false);
    }
  }, [input, params]);

  const save = useCallback(async () => {
    if (!input || !result) return;
    try {
      await saveSimulation(input, result);
      setSaveNote('Saved to your account.');
    } catch (e) {
      setSaveNote(
        e instanceof ApiError && e.unauthenticated
          ? 'Sign in to save a run — a saved route records where you went and when.'
          : `Could not save: ${e}`,
      );
    }
  }, [input, result]);

  const primary = params[0] ?? 'pm25';
  const primarySummary = result?.results[primary] ?? null;
  const { caution, high } = bands(primarySummary?.threshold ?? null);

  const chartData = useMemo(
    () => (result?.points ?? []).map((p) => ({ x: p.distance_m, y: p.values[primary] ?? null })),
    [result, primary],
  );

  const segments: RouteSegment[] = useMemo(() => {
    const pts = result?.points ?? [];
    const out: RouteSegment[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const av = a.values[primary];
      const bv = b.values[primary];
      // Both ends must be measured for the segment to carry a colour. One measured end
      // describes an instant, not the stretch between here and the next point.
      const value = av != null && bv != null ? (av + bv) / 2 : null;
      out.push({
        from: { lat: a.lat, lon: a.lon },
        to: { lat: b.lat, lon: b.lon },
        color: bandColor(value, caution, high),
      });
    }
    return out;
  }, [result, primary, caution, high]);

  const mapStations = useMemo(
    () =>
      (config?.stations ?? [])
        .filter((s) => result?.sensors_used.includes(s.node_code))
        .map((s) => ({ ...s, color: colors.primaryDark })),
    [config, result],
  );

  if (configError) return <ErrorState reason={configError} />;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, measure]}>
      <Text style={styles.title}>Route Exposure Simulator</Text>
      <Text style={styles.lede}>
        Walk a route through the recorded air. Each point along the way is matched to the
        nearest station and read at the time you would have been standing there.
      </Text>

      <InfoCard title="Route">
        <View style={styles.row}>
          <Field label="Start lat" value={startLat} onChange={setStartLat} />
          <Field label="Start lng" value={startLng} onChange={setStartLng} />
          <Field label="Destination lat" value={destLat} onChange={setDestLat} />
          <Field label="Destination lng" value={destLng} onChange={setDestLng} />
        </View>
        <View style={styles.row}>
          <Field label="Date" value={date} onChange={setDate} hint="YYYY-MM-DD" />
          <Field label="Start time" value={time} onChange={setTime} hint="HH:MM" width={110} />
          <Field label="Speed m/s" value={speed} onChange={setSpeed}
                 hint={String(config?.travel_modes[mode]?.default_speed_mps ?? '')} width={110} />
          <Field label="Sample every (m)" value={spacing} onChange={setSpacing} width={130} />
          <Field label="Sensor range (m)" value={maxSensor} onChange={setMaxSensor} width={130} />
        </View>

        <SectionLabel>Travel mode</SectionLabel>
        <View style={styles.chips}>
          {TRAVEL_MODES.map((m) => (
            <Chip key={m} label={m} selected={mode === m} onPress={() => setMode(m)} />
          ))}
        </View>

        <SectionLabel>Parameters</SectionLabel>
        <View style={styles.chips}>
          {PARAMETER_CHOICES.map((p) => (
            <Chip
              key={p}
              label={p}
              selected={params.includes(p)}
              onPress={() =>
                setParams((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))
              }
            />
          ))}
        </View>

        <View style={styles.actions}>
          <PrimaryButton label={running ? 'Simulating…' : 'Run simulation'} onPress={run} disabled={running} />
          {result ? <SecondaryButton label="Save this run" onPress={save} /> : null}
        </View>
        {saveNote ? <Text style={styles.note}>{saveNote}</Text> : null}
      </InfoCard>

      {error ? <ErrorState reason={error} onRetry={run} /> : null}
      {running ? <LoadingState /> : null}

      {result ? (
        <>
          <InfoCard title="Result">
            <MetaRow label="Distance" value={`${(result.distance_m / 1000).toFixed(2)} km`} />
            <MetaRow label="Duration" value={minutes(result.duration_s)} />
            <MetaRow label="Data coverage" value={`${(result.coverage * 100).toFixed(0)}%`} />
            <MetaRow label="Stations used" value={result.sensors_used.join(', ') || 'None in range'} />
            <MetaRow label="Route from" value={`${result.route.provider} (${result.route.profile})`} />
            {result.route.note ? <Text style={styles.note}>{result.route.note}</Text> : null}
            {result.coverage < 1 ? (
              <Text style={styles.note}>
                {(100 - result.coverage * 100).toFixed(0)}% of this route had no station within{' '}
                {maxSensor} m, or none reporting at the time. Those stretches are shown as No
                Data and are left out of the statistics rather than estimated.
              </Text>
            ) : null}
          </InfoCard>

          <View style={styles.grid}>
            {params.map((p) => {
              const s = result.results[p];
              if (!s) return null;
              return (
                <InfoCard key={p} title={p.toUpperCase()} style={styles.gridCard}>
                  <MetaRow label="Average" value={`${fmt(s.average)} ${s.unit}`} />
                  <MetaRow label="Minimum" value={`${fmt(s.minimum)} ${s.unit}`} />
                  <MetaRow label="Maximum" value={`${fmt(s.maximum)} ${s.unit}`} />
                  {s.exposure_integral != null ? (
                    <MetaRow label="Exposure" value={`${fmt(s.exposure_integral, 0)} ${s.exposure_unit}`} />
                  ) : null}
                  {s.time_above_threshold_s != null ? (
                    <MetaRow
                      label={`Above ${s.threshold} ${s.unit}`}
                      value={minutes(s.time_above_threshold_s)}
                    />
                  ) : null}
                  <MetaRow label="Samples" value={`${s.sample_count}`} />
                </InfoCard>
              );
            })}
          </View>

          <InfoCard title={`${primary.toUpperCase()} along the route`}>
            <SeriesChart data={chartData} caution={caution} high={high}
                         unit={primarySummary?.unit} emptyLabel="No station covered this route" />
            <Text style={styles.axisCaption}>Distance from start (m)</Text>
            <SectionLabel>Heat route</SectionLabel>
            <HeatStrip data={chartData} caution={caution} high={high} />
            <BandLegend caution={caution} high={high} unit={primarySummary?.unit ?? ''} />
          </InfoCard>

          <InfoCard title="Map">
            <RouteMap segments={segments} stations={mapStations} />
          </InfoCard>

          <Text style={styles.disclaimer}>{result.disclaimer}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  title: { ...type.h1, color: colors.text },
  lede: { ...type.secondary, color: colors.textMuted },
  row: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
  chips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  fieldLabel: { ...type.caption, color: colors.textMuted, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: space.sm, paddingVertical: space.sm,
    backgroundColor: colors.surface, color: colors.text, ...type.body,
  },
  actions: { flexDirection: 'row', gap: space.md, alignItems: 'center', marginTop: space.sm },
  note: { ...type.caption, color: colors.textMuted },
  grid: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
  gridCard: { flexGrow: 1, flexBasis: 220 },
  axisCaption: { ...type.caption, color: colors.textFaint, textAlign: 'center' },
  disclaimer: { ...type.caption, color: colors.textMuted, fontStyle: 'italic' },
});
