/**
 * Chart primitives for the dashboard, drawn with plain Views.
 *
 * There is no charting library and no react-native-svg here on purpose. Both dashboards are
 * web-only, but everything under src/ is bundled for the native app too, and adding a native
 * module would invalidate every APK already installed. Bars and absolutely-positioned
 * segments render identically on web and native and cost nothing.
 *
 * A gap in the data is drawn as a gap. Every series here can be missing values — a route
 * point with no station in range, a replay window a station did not write — and joining
 * across one would draw a line through air nobody measured.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';

export type SeriesPoint = { x: number; y: number | null };

/** Concentration -> the watch palette. Engineering bands for reading a chart (§3.14), using
 *  the same colours the rest of the app labels air with — never a statement about a person. */
export function bandColor(value: number | null, caution: number, high: number): string {
  if (value == null) return colors.unknown;
  if (value >= high) return colors.high;
  if (value >= caution) return colors.caution;
  return colors.normal;
}

function niceCeiling(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

/**
 * A column chart over an x-ordered series.
 *
 * Columns rather than a polyline: with one View per sample a missing value is simply a column
 * that is not drawn, whereas a line would have to either skip or bridge the hole, and bridging
 * is the thing this codebase refuses to do everywhere else.
 */
export function SeriesChart({
  data,
  height = 160,
  caution,
  high,
  unit,
  cursorX = null,
  emptyLabel = 'No data',
}: {
  data: SeriesPoint[];
  height?: number;
  caution?: number;
  high?: number;
  unit?: string;
  /** Draws a vertical marker at this x — the replay cursor (§4.10). */
  cursorX?: number | null;
  emptyLabel?: string;
}) {
  const { max, xMin, xSpan, measured } = useMemo(() => {
    const ys = data.map((d) => d.y).filter((y): y is number => y != null);
    const xs = data.map((d) => d.x);
    const lo = xs.length ? Math.min(...xs) : 0;
    const hi = xs.length ? Math.max(...xs) : 1;
    return {
      max: niceCeiling(ys.length ? Math.max(...ys) : 1),
      xMin: lo,
      xSpan: hi - lo || 1,
      measured: ys.length,
    };
  }, [data]);

  if (!measured) {
    return (
      <View style={[styles.plot, { height }]}>
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      </View>
    );
  }

  const cursorPct = cursorX == null ? null : ((cursorX - xMin) / xSpan) * 100;

  return (
    <View style={styles.chartWrap}>
      <View style={styles.axisY}>
        <Text style={styles.axisText}>{max}</Text>
        <Text style={styles.axisText}>{Math.round(max / 2)}</Text>
        <Text style={styles.axisText}>0</Text>
      </View>
      <View style={[styles.plot, { height }]}>
        {caution != null && caution < max ? (
          <View style={[styles.threshold, { bottom: (caution / max) * height }]} />
        ) : null}
        <View style={styles.columns}>
          {data.map((d, i) => (
            <View key={i} style={styles.column}>
              {d.y == null ? null : (
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(2, (d.y / max) * (height - 8)),
                      backgroundColor:
                        caution != null && high != null
                          ? bandColor(d.y, caution, high)
                          : colors.primary,
                    },
                  ]}
                />
              )}
            </View>
          ))}
        </View>
        {cursorPct != null && cursorPct >= 0 && cursorPct <= 100 ? (
          <View style={[styles.cursor, { left: `${cursorPct}%` }]} />
        ) : null}
      </View>
      {unit ? <Text style={styles.unit}>{unit}</Text> : null}
    </View>
  );
}

/**
 * §3.14 — the route as a coloured strip, one block per sample in travel order.
 *
 * Stretches with no station in range are drawn in the No Data grey rather than skipped, so
 * the strip's length stays proportional to the walk and an uncovered kilometre is visible as
 * an uncovered kilometre.
 */
export function HeatStrip({
  data,
  caution,
  high,
  height = 22,
}: {
  data: SeriesPoint[];
  caution: number;
  high: number;
  height?: number;
}) {
  return (
    <View style={[styles.strip, { height }]}>
      {data.map((d, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: bandColor(d.y, caution, high) }} />
      ))}
    </View>
  );
}

/** A legend for the bands above. Uses the watch vocabulary and nothing outside it. */
export function BandLegend({ caution, high, unit }: { caution: number; high: number; unit: string }) {
  const items: [string, string][] = [
    [colors.normal, `< ${caution}`],
    [colors.caution, `${caution}–${high}`],
    [colors.high, `≥ ${high}`],
    [colors.unknown, 'No Data'],
  ];
  return (
    <View style={styles.legend}>
      {items.map(([color, label]) => (
        <View key={label} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: color }]} />
          <Text style={styles.legendText}>{label}</Text>
        </View>
      ))}
      <Text style={styles.legendUnit}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chartWrap: { flexDirection: 'row', gap: space.sm, alignItems: 'stretch' },
  axisY: { justifyContent: 'space-between', paddingVertical: 2, minWidth: 34 },
  axisText: { ...type.caption, color: colors.textFaint, textAlign: 'right' },
  plot: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  columns: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    flexDirection: 'row', alignItems: 'flex-end', gap: 1, padding: 4,
  },
  column: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 2, minHeight: 2 },
  threshold: {
    position: 'absolute', left: 0, right: 0, height: 1,
    backgroundColor: colors.caution, opacity: 0.55,
  },
  cursor: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.primaryDark },
  unit: { ...type.caption, color: colors.textFaint, alignSelf: 'flex-end' },
  emptyText: { ...type.secondary, color: colors.textFaint, textAlign: 'center' },
  strip: { flexDirection: 'row', borderRadius: radius.sm, overflow: 'hidden', gap: 0 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legendText: { ...type.caption, color: colors.textMuted },
  legendUnit: { ...type.caption, color: colors.textFaint, marginLeft: 'auto' },
});
