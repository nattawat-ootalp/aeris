# Demo runbook

What to do before presenting, and why some cards cannot be made ready in advance.

## The short version

Seeding fills the **history** screens. Only a **live, connected device** fills the current-risk
and forecast cards. Have the portable connected and reporting for about **five minutes** before
you present, and everything is ready.

## Why five minutes

The engine refuses to produce a number until it has enough data, and each stage has its own
threshold (`intelligence/config.py`). At the firmware's 5 s sample cadence:

| Card | Needs | Time with a connected device |
|---|---|---|
| Current reading | 1 sample | immediate |
| Current risk | `RISK_MIN_SAMPLES` = 10 samples, freshest under 120 s old | ~1 minute |
| Forecast | `FORECAST_MIN_SAMPLES` = 6 samples inside a 1 h window, freshest under 120 s old | ~1 minute |
| Personal baseline | `BASELINE_MIN_SAMPLES` = 50 samples over 14 days | ~4–5 minutes |
| Personal pattern | `PATTERN_MIN_SAMPLES` = 20 **symptom entries** you logged | not time-based |

The Personal Baseline screen shows its own progress (`12 of 50 readings collected`), so you can
watch it rather than guess.

Personal pattern counts symptoms the user logged, not sensor readings. It cannot be reached by
leaving a device running; it needs entries in the symptom log.

## Why seeding cannot substitute for a live device

`intelligence/predict.py` rejects any series whose newest point is older than
`FRESHNESS_MAX_AGE_SEC` (120 s), and the same freshness rule governs the current risk in
`intelligence/quality.py` (`usable = pm25_valid and fresh`). A backfilled fortnight of history
is still, by definition, not fresh. So:

- **Seedable:** personal baseline, weekly summary, exposure timeline, data-quality history.
- **Not seedable:** current reading, current risk, forecast. These say "No Data" or
  "ยังพยากรณ์ไม่ได้" until a device is actually reporting, and that is correct behaviour, not a bug.

## Seeding a demo device

```
python scripts/seed_demo.py --device-id DEMO-ROOM-001 --days 14 --dry-run   # preview
python scripts/seed_demo.py --device-id DEMO-ROOM-001 --days 14             # write
```

Reads the same `INFLUXDB_*` settings as the ingestion service.

The script will only write to a device id starting with `DEMO-`, and tags every point
`source="demo"` in InfluxDB beside the real `portable` and `station` sources. Both are
deliberate: generated readings must never land in a real device's series, and it must stay
possible to separate them afterwards. Pointing it at a real device id is refused, not warned
about.

## Getting the app to show the seeded device

No separate codebase is needed, but the environment variable alone is **not** enough.

`useActiveDeviceId()` in `mobile/src/lib/device.ts` resolves in this order:

1. the portable currently connected over BLE
2. the first device registered to the signed-in account (`GET /me/devices`)
3. `EXPO_PUBLIC_DEFAULT_DEVICE_ID`
4. the top-ranked public station

The override is third. And the baseline and pattern endpoints require auth, so the demo has to
be signed in — which means step 2 is live and will win over step 3 for any account that has ever
paired a device. Setting the variable and nothing else gives you a demo showing a real device's
empty history.

**Register the demo device to the account you will present with**, which makes it resolve at
step 2 without depending on the variable at all:

```
python scripts/seed_demo.py --device-id DEMO-ROOM-001 --days 14 --owner <supabase-user-uuid>
```

The user id is the `sub` of that account's JWT. Use an account with no other device registered,
or the ordering (`last_seen` descending) decides which one appears.

Setting `EXPO_PUBLIC_DEFAULT_DEVICE_ID=DEMO-ROOM-001` in a second Vercel project is still worth
doing as a backstop for the signed-out case. Everything else — API base URL, Supabase keys —
stays as it is in the real project.

A connected portable outranks all of this. Pair a real device during the demo and you will see
the real device, which is usually what you want on stage.

## During the demo

- **Do not unpair or walk out of range and expect the graph to stop.** Since the buffering work,
  the device holds an hour of readings and replays them on reconnect, and the phone holds
  another ~2.8 hours for the backend. Sensor Health shows both queues and the count of anything
  lost.
- **A cold API costs ~50 s on the first request.** The backend sleeps when idle on the free
  hosting tier. Open the app once a minute before you present so the first screen is not a
  spinner.
- **The forecast card will refuse if you pause too long.** Anything over two minutes without a
  reading makes the newest sample stale and the card returns to "not enough data". Keep the
  device connected throughout.
