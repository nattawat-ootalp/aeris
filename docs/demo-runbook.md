# Demo runbook

How to get every screen showing data, and why one group of cards cannot be filled in advance.

## Prerequisite: credentials

Both scripts write straight to InfluxDB and Supabase, so they need the service credentials the
backend uses. `ingestion/app/config.py` loads them from a `.env` at the **repo root**:

```
cp /path/to/your/.env ./.env      # aeris/.env — already in .gitignore
```

`INFLUXDB_URL`, `INFLUXDB_TOKEN`, `INFLUXDB_ORG`, `INFLUXDB_BUCKET` are needed for the readings;
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` additionally for `--owner`. Without them the
scripts fail on the first write rather than silently doing nothing.

## The short version

```
# 1. history — run once, minutes before or days before
python scripts/seed_demo.py --device-id DEMO-ROOM-001 --days 14 --owner <supabase-user-uuid>

# 2. live cards — leave running during the demo
python scripts/feed_demo.py --device-id DEMO-ROOM-001
```

Add `--dry-run` to the seeder first to see what it would write without writing it.

Sign into the app with that same account. Give the feeder about a minute before you present.

A real portable, connected for five minutes, does all of this on its own and is the better demo
where the hardware is available.

## Which screens need what

| Screen | Needs | Filled by |
|---|---|---|
| Current reading | 1 fresh sample | feeder / device |
| Current risk | 10 samples, newest < 120 s old | feeder / device |
| Forecast | 6 samples in a 1 h window, newest < 120 s old | feeder / device |
| Personal baseline | 50 samples over 14 days | seeder |
| Exposure timeline | readings crossing 37.5 µg/m³ | seeder |
| Daily summary / weekly | readings across the period | seeder |
| Data quality | recent readings | seeder + feeder |
| Personal pattern | 20 **symptom entries** | seeder (`--owner`) |
| Sensor Health | a paired device over BLE | real device only |

Thresholds come from `intelligence/config.py` — `RISK_MIN_SAMPLES`, `FORECAST_MIN_SAMPLES`,
`BASELINE_MIN_SAMPLES`, `PATTERN_MIN_SAMPLES`, `FRESHNESS_MAX_AGE_SEC`.

## Why history alone cannot fill the live cards

`intelligence/predict.py` rejects any series whose newest point is older than
`FRESHNESS_MAX_AGE_SEC` (120 s), and `intelligence/quality.py` gates usability the same way
(`usable = pm25_valid and fresh`). Backfilled history is, by definition, never fresh — so
current reading, current risk and forecast stay at "No Data" no matter how much you seed.

That is correct behaviour, not a bug: the app is built never to present a stale number as the
present. The only fix is to keep producing readings, which is what `feed_demo.py` does and what
a connected device does.

The live cards stay populated for about two minutes after the last reading, then return to
No Data. Do not stop the feeder mid-presentation.

## What the seeder writes

- **14 days of readings**, one every 2 minutes, with a daily rhythm plus roughly five
  elevated-exposure episodes per week reaching 48–96 µg/m³. The episodes matter: without
  something crossing the 37.5 caution threshold the exposure timeline has no segments to draw
  and the pattern screen reports a confident zero.
- **26 symptom entries** (with `--owner`), about two thirds of them within 6 hours of an
  episode. Deliberately not all of them — an association of exactly 1.0 would read as invented.
- **A device registration** for the owning account, so the app resolves the demo device.

Everything is written to a device id starting with `DEMO-` and tagged `source="demo"` in
InfluxDB, beside the real `portable` and `station` sources. Pointing the seeder at a real device
id is refused outright, not warned about. Both are deliberate: generated readings must never
land in a real device's series, and it must stay possible to separate them afterwards.

## Getting the app to show the seeded device

The environment variable alone is **not** enough. `useActiveDeviceId()` in
`mobile/src/lib/device.ts` resolves in this order:

1. the portable currently connected over BLE
2. the first device registered to the signed-in account (`GET /me/devices`)
3. `EXPO_PUBLIC_DEFAULT_DEVICE_ID`
4. the top-ranked public station

The override is third, and the baseline and pattern endpoints require auth — so the demo has to
be signed in, which makes step 2 live and it wins for any account that has ever paired a device.
Setting the variable and nothing else gives you a demo showing a real device's empty history.

`--owner` fixes this by registering the demo device at step 2. The value is the `sub` of that
account's JWT — Supabase dashboard → Authentication → Users → the user's UID. Use an account
with no other device registered, or the ordering (`last_seen` descending) decides which appears.
The same id files the symptom entries, which are per-user rather than per-device.

## Web

**https://aeris-web-nextair.vercel.app** — already live, deploys from `main`, nothing to build.
Sign in with the demo account and it picks up everything above.

Web Bluetooth works on desktop Chrome only. Safari and iOS have no implementation at all, and
Android Chrome additionally needs system Location on and granted to Chrome.

## Android APK

```
cd mobile
npx eas build -p android --profile demo
```

The `demo` profile points at the production API and sets `EXPO_PUBLIC_DEFAULT_DEVICE_ID` as a
backstop for the signed-out case. Use `--profile preview` for a build that resolves whatever
device the account owns.

EAS builds in the cloud and needs an Expo account login, so this one is yours to run.

## During the demo

- **Keep the feeder running.** Two minutes without a reading and the live cards go back to
  No Data.
- **A cold API costs ~50 s on the first request.** The backend sleeps when idle on the free
  tier. Open the app a minute beforehand so the first screen is not a spinner.
- **Walking out of BLE range no longer stops the record.** Since the buffering work the device
  holds an hour of readings and replays them on reconnect, and the phone holds another ~2.8
  hours for the backend. Sensor Health shows both queues and the count of anything lost — a good
  thing to demo deliberately rather than discover by accident.
