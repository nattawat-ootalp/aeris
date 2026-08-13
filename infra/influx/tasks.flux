// =============================================================================
// Aeris — InfluxDB Cloud downsampling task (TDD §8 time-series, §13).
//
// WHAT THIS DOES
//   Every 5 minutes, take the raw `air_quality` measurement from the live bucket and write a
//   5-minute MEAN into a separate archive bucket. Downsampling early is REQUIRED on the free
//   tier (docs/DECISIONS.md): InfluxDB Cloud Free has ~30-day retention and a write-rate cap,
//   so we keep raw data short-lived and retain the cheaper aggregate for history.
//
// MEASUREMENTS (written by ingestion):
//   * air_quality  — environmental telemetry. Fields include pm25, pm10, temperature, humidity,
//                    plus the Aeris-added fields `quality_score` (§5.1 data-quality gate output)
//                    and `exposure` (§5.3 aggregated exposure). This task aggregates these.
//   * device_health — battery / rssi / uptime / fw_version. Kept SEPARATE from environmental
//                     status (TDD §14) and intentionally NOT downsampled here (low volume; and
//                     averaging a firmware version / battery state is not meaningful).
//
// FREE-TIER WRITE-RATE CAUTION:
//   mean() over a 5-minute window collapses many raw points into one, cutting archive write
//   volume. Do not lower `every` below the ingestion cadence or you re-inflate write load.
//   `quality_score` is averaged for reference only — a low mean quality_score means the window
//   is data-quality suspect and downstream must still honor §5.1 gating (never treat a stale or
//   invalid window as current).
//
// SETUP (one-time, in the InfluxDB UI):
//   1. Create the archive bucket `sensor_data_archive` (a longer retention than the raw bucket).
//   2. Paste this task (Data > Tasks > Create Task, or `influx task create`).
//   3. Adjust bucket names if your live bucket is not `sensor_data` (env INFLUXDB_BUCKET).
//      `to()` writes to the org that owns the task, so org is not hardcoded here.
// =============================================================================

option task = {name: "aeris_downsample_air_quality_5m", every: 5m}

// Source (live) and destination (archive) buckets. Match INFLUXDB_BUCKET for the source.
srcBucket = "sensor_data"
dstBucket = "sensor_data_archive"

from(bucket: srcBucket)
    // look back one task interval; -task.every keeps windows aligned and avoids reprocessing.
    |> range(start: -task.every)
    |> filter(fn: (r) => r._measurement == "air_quality")
    // aggregate the numeric environmental fields + the Aeris-added fields.
    |> filter(fn: (r) =>
        r._field == "pm25" or
        r._field == "pm10" or
        r._field == "temperature" or
        r._field == "humidity" or
        r._field == "quality_score" or
        r._field == "exposure"
    )
    // 5-minute mean; createEmpty:false so gaps stay gaps (do not fabricate data, §5.1).
    |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)
    // preserve identifying tags (e.g. device_id / node_id / org) into the archive.
    |> to(bucket: dstBucket)
