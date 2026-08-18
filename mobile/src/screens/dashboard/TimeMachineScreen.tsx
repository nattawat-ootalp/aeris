/**
 * §4 Air Quality Time Machine — replay recorded station data along a timeline.
 *
 * Web dashboard only. Playback lives entirely in this component: the server hands over every
 * frame in the chosen span once, and the cursor, the speed multiplier and pause/resume never
 * touch the network again. Scrubbing a timeline that re-queried on every step would be
 * unusable, and the whole point of the screen is moving through time quickly.
 *
 * A station missing from a frame recorded nothing in that window. Its card says No Data for
 * that instant rather than holding the last value it did write — a marker that keeps reading
 * 25 ug/m3 through an outage is indistinguishable from a station that is genuinely steady.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  ApiError,
  compareReplay,
  createReplayBookmark,
  deleteReplayBookmark,
  getReplayBookmarks,
  getReplayData,
  getReplayStations,
  replayExportUrl,
} from '../../api/client';
import { SeriesChart } from '../../components/charts';
import { Chip, ErrorState, InfoCard, LoadingState, MetaRow, PrimaryButton, SecondaryButton, SectionLabel } from '../../components/ui';
import { useMeasureStyle } from '../../lib/responsive';
import { colors, radius, space, statusColor, type } from '../../theme';
import type { CompareResult, ReplayBookmark, ReplayData, ReplayStations } from '../../types';

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 60];
const PARAMETER_CHOICES = ['pm25', 'co2', 'tvoc', 'temperature', 'humidity'] as const;

/** Real seconds between frames at 1x, given the data's own interval. At 60x an hour of
 *  recording plays in a minute, which is what the speed multiplier means (§4.7). */
function frameDelayMs(interval: string, speed: number): number {
  const n = Number(interval.slice(0, -1));
  const unit = interval.slice(-1);
  const seconds = unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
  // Floored so a fast multiplier over a coarse interval does not ask the browser for a frame
  // rate it cannot hit; below this the playhead simply advances as fast as it is able.
  return Math.max(40, (seconds * 1000) / speed);
}

function localInput(d: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function clockLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function Field({ label, value, onChange, hint, width = 140 }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string; width?: number;
}) {
  return (
    <View style={{ width }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange} placeholder={hint}
                 placeholderTextColor={colors.textFaint} />
    </View>
  );
}

export function TimeMachineScreen() {
  const measure = useMeasureStyle();
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => localInput(now), [now]);

  const [catalogue, setCatalogue] = useState<ReplayStations | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [parameter, setParameter] = useState<string>('pm25');
  const [date, setDate] = useState(today.date);
  const [from, setFrom] = useState('08:00');
  const [to, setTo] = useState('18:00');
  const [interval, setIntervalChoice] = useState<string>('5m');

  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);

  const [compareDate, setCompareDate] = useState(today.date);
  const [comparison, setComparison] = useState<CompareResult | null>(null);
  const [bookmarks, setBookmarks] = useState<ReplayBookmark[] | null>(null);
  const [bookmarkTitle, setBookmarkTitle] = useState('');
  const [bookmarkNote, setBookmarkNote] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getReplayStations()
      .then((c) => {
        setCatalogue(c);
        // Pre-select what can actually be replayed, so the first load is not empty.
        setSelected(c.stations.filter((s) => s.active).map((s) => s.node_code).slice(0, 4));
      })
      .catch((e) => setError(String(e)));
  }, []);

  const range = useMemo(() => {
    const start = new Date(`${date}T${from}:00`);
    const end = new Date(`${date}T${to}:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
    return { start: start.toISOString(), end: end.toISOString() };
  }, [date, from, to]);

  const load = useCallback(async () => {
    if (!range) {
      setError('Check the date and times — the end must be after the start.');
      return;
    }
    if (!selected.length) {
      setError('Choose at least one station.');
      return;
    }
    setLoading(true);
    setError(null);
    setPlaying(false);
    try {
      const d = await getReplayData({
        stationIds: selected, start: range.start, end: range.end,
        parameters: [parameter], interval,
      });
      setData(d);
      setFrameIndex(0);
    } catch (e) {
      setData(null);
      setError(e instanceof ApiError ? `Could not load (HTTP ${e.status})` : String(e));
    } finally {
      setLoading(false);
    }
  }, [range, selected, parameter, interval]);

  // Playback. A chained timeout rather than an interval: the delay changes with the speed
  // multiplier, and an interval would keep firing at whatever rate it was created with.
  useEffect(() => {
    if (!playing || !data || !data.frames.length) return;
    const delay = frameDelayMs(data.interval, speed);
    timer.current = setTimeout(() => {
      setFrameIndex((i) => {
        if (i + 1 >= data.frames.length) {
          setPlaying(false);      // stop at the end rather than looping back to the start
          return i;
        }
        return i + 1;
      });
    }, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, frameIndex, data, speed]);

  const frame = data?.frames[frameIndex] ?? null;

  const chartData = useMemo(() => {
    if (!data) return [];
    const first = data.frames.length ? new Date(data.frames[0].timestamp).getTime() : 0;
    // One line is drawn, for the first selected station: several overlapping column series in
    // one plot would be unreadable, and the per-station numbers are in the cards below.
    const station = selected[0];
    return data.frames.map((f) => ({
      x: (new Date(f.timestamp).getTime() - first) / 60000,
      y: f.stations[station]?.[parameter] ?? null,
    }));
  }, [data, selected, parameter]);

  const cursorX = chartData[frameIndex]?.x ?? null;

  const runCompare = useCallback(async () => {
    if (!frame || !selected.length) return;
    const at = new Date(frame.timestamp);
    const other = new Date(`${compareDate}T${localInput(at).time}:00`);
    if (Number.isNaN(other.getTime())) return;
    try {
      setComparison(await compareReplay({
        stationIds: selected, timeA: at.toISOString(),
        timeB: other.toISOString(), parameter,
      }));
    } catch (e) {
      setError(String(e));
    }
  }, [frame, selected, compareDate, parameter]);

  const loadBookmarks = useCallback(async () => {
    try {
      setBookmarks((await getReplayBookmarks()).bookmarks);
      setBookmarkNote(null);
    } catch (e) {
      setBookmarks([]);
      setBookmarkNote(
        e instanceof ApiError && e.unauthenticated
          ? 'Sign in to keep bookmarks — they are saved to your account.'
          : String(e),
      );
    }
  }, []);

  const addBookmark = useCallback(async () => {
    if (!frame || !bookmarkTitle.trim()) return;
    try {
      await createReplayBookmark({
        timestamp: frame.timestamp,
        station_id: selected[0] ?? null,
        parameter,
        title: bookmarkTitle.trim(),
      });
      setBookmarkTitle('');
      await loadBookmarks();
    } catch (e) {
      setBookmarkNote(
        e instanceof ApiError && e.unauthenticated
          ? 'Sign in to keep bookmarks — they are saved to your account.'
          : String(e),
      );
    }
  }, [frame, bookmarkTitle, selected, parameter, loadBookmarks]);

  const download = useCallback(
    (format: 'csv' | 'json') => {
      if (!range || !selected.length) return;
      const url = replayExportUrl(format, {
        stationIds: selected, start: range.start, end: range.end,
        parameters: [parameter], interval,
      });
      // The server already sets the filename through Content-Disposition; opening the URL
      // lets the browser save it without the bytes passing through JS at all.
      if (Platform.OS === 'web') window.open(url, '_blank');
    },
    [range, selected, parameter, interval],
  );

  const unit = data?.parameters[parameter]?.unit ?? '';

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, measure]}>
      <Text style={styles.title}>Air Quality Time Machine</Text>
      <Text style={styles.lede}>
        Play back what the stations recorded. Everything shown is a stored measurement; a
        station missing from an instant recorded nothing then.
      </Text>

      <InfoCard title="Window">
        <View style={styles.row}>
          <Field label="Date" value={date} onChange={setDate} hint="YYYY-MM-DD" />
          <Field label="From" value={from} onChange={setFrom} hint="HH:MM" width={100} />
          <Field label="To" value={to} onChange={setTo} hint="HH:MM" width={100} />
        </View>

        <SectionLabel>Interval</SectionLabel>
        <View style={styles.chips}>
          {(catalogue?.intervals ?? []).map((iv) => (
            <Chip key={iv} label={iv} selected={interval === iv} onPress={() => setIntervalChoice(iv)} />
          ))}
        </View>

        <SectionLabel>Stations</SectionLabel>
        <View style={styles.chips}>
          {(catalogue?.stations ?? []).map((s) => (
            <Chip
              key={s.node_code}
              label={`${s.node_code}${s.active ? '' : ' (inactive)'}`}
              selected={selected.includes(s.node_code)}
              onPress={() =>
                setSelected((cur) =>
                  cur.includes(s.node_code)
                    ? cur.filter((x) => x !== s.node_code)
                    : [...cur, s.node_code],
                )
              }
            />
          ))}
        </View>

        <SectionLabel>Parameter</SectionLabel>
        <View style={styles.chips}>
          {PARAMETER_CHOICES.map((p) => (
            <Chip key={p} label={p} selected={parameter === p} onPress={() => setParameter(p)} />
          ))}
        </View>

        <View style={styles.actions}>
          <PrimaryButton label={loading ? 'Loading…' : 'Load'} onPress={load} disabled={loading} />
          {data ? <SecondaryButton label="Export CSV" onPress={() => download('csv')} /> : null}
          {data ? <SecondaryButton label="Export JSON" onPress={() => download('json')} /> : null}
        </View>
      </InfoCard>

      {error ? <ErrorState reason={error} onRetry={load} /> : null}
      {loading ? <LoadingState /> : null}

      {data && data.frames.length === 0 ? (
        <InfoCard title="Nothing recorded">
          <Text style={styles.note}>
            No station wrote anything in this window. Nothing is drawn rather than a flat line
            at zero — an empty period and a quiet one are not the same reading.
          </Text>
        </InfoCard>
      ) : null}

      {data && data.frames.length > 0 && frame ? (
        <>
          <InfoCard title="Timeline">
            {data.interval_coarsened ? (
              <Text style={styles.note}>
                Showing {data.interval} frames — {data.requested_interval} over this span would
                exceed what one response can carry. Narrow the window for finer detail.
              </Text>
            ) : null}

            <Text style={styles.clock}>{clockLabel(frame.timestamp)}</Text>

            {/* The scrubber. Each frame is its own pressable cell, so a click lands on a real
                recorded instant rather than on an interpolated position between two. */}
            <View style={styles.scrubber}>
              {data.frames.map((f, i) => (
                <Pressable
                  key={f.timestamp}
                  onPress={() => {
                    setPlaying(false);
                    setFrameIndex(i);
                  }}
                  style={[styles.tick, i === frameIndex && styles.tickActive]}
                />
              ))}
            </View>
            <View style={styles.scrubberEnds}>
              <Text style={styles.axisCaption}>{clockLabel(data.frames[0].timestamp)}</Text>
              <Text style={styles.axisCaption}>
                {clockLabel(data.frames[data.frames.length - 1].timestamp)}
              </Text>
            </View>

            <View style={styles.controls}>
              <SecondaryButton label="|◀" onPress={() => { setPlaying(false); setFrameIndex(0); }} />
              <SecondaryButton label="◀" onPress={() => { setPlaying(false); setFrameIndex((i) => Math.max(0, i - 1)); }} />
              <PrimaryButton label={playing ? 'Pause' : 'Play'} onPress={() => setPlaying((p) => !p)} />
              <SecondaryButton label="▶" onPress={() => { setPlaying(false); setFrameIndex((i) => Math.min(data.frames.length - 1, i + 1)); }} />
              <SecondaryButton label="▶|" onPress={() => { setPlaying(false); setFrameIndex(data.frames.length - 1); }} />
            </View>

            <SectionLabel>Speed</SectionLabel>
            <View style={styles.chips}>
              {SPEEDS.map((s) => (
                <Chip key={s} label={`${s}x`} selected={speed === s} onPress={() => setSpeed(s)} />
              ))}
            </View>
            <MetaRow label="Frame" value={`${frameIndex + 1} / ${data.frame_count}`} />
          </InfoCard>

          <View style={styles.grid}>
            {selected.map((code) => {
              const values = frame.stations[code];
              return (
                <InfoCard key={code} title={code} style={styles.gridCard}>
                  {values ? (
                    Object.entries(values).map(([k, v]) => (
                      <MetaRow key={k} label={k.toUpperCase()}
                               value={`${v} ${data.parameters[k]?.unit ?? ''}`} />
                    ))
                  ) : (
                    <Text style={styles.noData}>No Data at this instant</Text>
                  )}
                  {data.stats[code]?.[parameter] ? (
                    <Text style={styles.note}>
                      Window min {data.stats[code][parameter].minimum} · max{' '}
                      {data.stats[code][parameter].maximum} · mean{' '}
                      {data.stats[code][parameter].average} {unit}
                    </Text>
                  ) : (
                    <Text style={styles.note}>Nothing recorded in this window</Text>
                  )}
                </InfoCard>
              );
            })}
          </View>

          <InfoCard title={`${parameter.toUpperCase()} — ${selected[0] ?? ''}`}>
            <SeriesChart data={chartData} unit={unit} cursorX={cursorX}
                         emptyLabel="This station recorded nothing in the window" />
            <Text style={styles.axisCaption}>Minutes from the start of the window</Text>
          </InfoCard>

          <InfoCard title="Compare with another day">
            <View style={styles.row}>
              <Field label="Compare date" value={compareDate} onChange={setCompareDate} hint="YYYY-MM-DD" />
              <View style={styles.compareAction}>
                <SecondaryButton label="Compare at this time" onPress={runCompare} />
              </View>
            </View>
            {comparison ? (
              <View style={styles.table}>
                <View style={styles.tr}>
                  <Text style={[styles.th, styles.cellWide]}>Station</Text>
                  <Text style={styles.th}>A</Text>
                  <Text style={styles.th}>B</Text>
                  <Text style={styles.th}>Diff</Text>
                  <Text style={styles.th}>%</Text>
                </View>
                {comparison.rows.map((r) => (
                  <View key={r.station_id} style={styles.tr}>
                    <Text style={[styles.td, styles.cellWide]}>{r.station_id}</Text>
                    <Text style={styles.td}>{r.value_a ?? '—'}</Text>
                    <Text style={styles.td}>{r.value_b ?? '—'}</Text>
                    <Text style={[styles.td, r.difference != null && {
                      color: r.difference > 0 ? colors.high : colors.normal,
                    }]}>
                      {r.difference == null ? 'No Data' : `${r.difference > 0 ? '+' : ''}${r.difference}`}
                    </Text>
                    <Text style={styles.td}>
                      {r.percent_change == null ? '—' : `${r.percent_change}%`}
                    </Text>
                  </View>
                ))}
                <Text style={styles.note}>
                  Each side is the mean over a 15-minute window centred on its instant, not one
                  sample: at 30 s cadence a single point is noise, and a difference between two
                  noisy points reads as a change that never happened.
                </Text>
              </View>
            ) : null}
          </InfoCard>

          <InfoCard title="Bookmarks">
            <View style={styles.row}>
              <Field label="Mark this instant" value={bookmarkTitle} onChange={setBookmarkTitle}
                     hint="PM2.5 spike" width={220} />
              <View style={styles.compareAction}>
                <SecondaryButton label="+ Bookmark" onPress={addBookmark} />
                <SecondaryButton label="Refresh" onPress={loadBookmarks} />
              </View>
            </View>
            {bookmarkNote ? <Text style={styles.note}>{bookmarkNote}</Text> : null}
            {(bookmarks ?? []).map((b) => (
              <Pressable key={b.id} onPress={() => {
                const i = data.frames.findIndex((f) => f.timestamp >= b.timestamp);
                if (i >= 0) {
                  setPlaying(false);
                  setFrameIndex(i);
                }
              }}>
                <View style={styles.bookmarkRow}>
                  <View style={[styles.dot, { backgroundColor: statusColor('Normal') }]} />
                  <Text style={styles.bookmarkTitle}>{b.title}</Text>
                  <Text style={styles.bookmarkMeta}>{clockLabel(b.timestamp)}</Text>
                  <Pressable onPress={() => deleteReplayBookmark(b.id).then(loadBookmarks)}>
                    <Text style={styles.remove}>remove</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </InfoCard>
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
  row: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap', alignItems: 'flex-end' },
  chips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  fieldLabel: { ...type.caption, color: colors.textMuted, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: space.sm, paddingVertical: space.sm,
    backgroundColor: colors.surface, color: colors.text, ...type.body,
  },
  actions: { flexDirection: 'row', gap: space.md, alignItems: 'center', marginTop: space.sm, flexWrap: 'wrap' },
  controls: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' },
  clock: { ...type.display, color: colors.text },
  scrubber: {
    flexDirection: 'row', gap: 1, height: 34, alignItems: 'stretch',
    backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, padding: 3,
    borderWidth: 1, borderColor: colors.border,
  },
  tick: { flex: 1, backgroundColor: colors.border, borderRadius: 2 },
  tickActive: { backgroundColor: colors.primary },
  scrubberEnds: { flexDirection: 'row', justifyContent: 'space-between' },
  axisCaption: { ...type.caption, color: colors.textFaint },
  grid: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
  gridCard: { flexGrow: 1, flexBasis: 220 },
  noData: { ...type.bodyStrong, color: colors.textFaint },
  note: { ...type.caption, color: colors.textMuted },
  compareAction: { flexDirection: 'row', gap: space.sm },
  table: { gap: 2, marginTop: space.sm },
  tr: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  th: { ...type.caption, color: colors.textMuted, flex: 1 },
  td: { ...type.secondary, color: colors.text, flex: 1 },
  cellWide: { flex: 2 },
  bookmarkRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bookmarkTitle: { ...type.bodyStrong, color: colors.text, flex: 1 },
  bookmarkMeta: { ...type.caption, color: colors.textMuted },
  remove: { ...type.caption, color: colors.high },
});
