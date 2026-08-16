# Changelog

Versions were not tracked while the app was being built out — `1.0.0` / `versionCode 1` stayed
in place across every release build, so a device could not tell two very different APKs apart.
This file reconstructs the history from the commits that actually shipped user-visible change,
and the version is now bumped with each one.

Semantic versioning: MINOR for new capability, PATCH for fixes. The app is pre-1.0 in maturity
but shipped as `1.0.0`, so the numbering continues from there rather than renumbering history.

`versionCode` is the Android install counter — it only ever increases, one per release build.

## 1.4.2 — `versionCode 7` (2026-08-16)

- Failed requests keep their HTTP status, so the app distinguishes "not signed in" (401/403)
  from "the server is unreachable". Every authenticated screen said "Could not load…" for
  both, which points the user at the wrong fix.

## 1.4.1 — `versionCode 6` (2026-08-16)

- Every sensor key (`pm25`, `temperature`, `humidity`, `co2`, `tvoc`, `eco2`) is always present
  in the decision contract, as explicit nulls when there is no reading. They were being omitted
  entirely, so TVOC and eCO2 never appeared in the app.
- Readings show the clock time they were taken (`measured_at`) next to their age.
- Absent values render "No Data" instead of a dash.
- Portable firmware compiles again — the SOS `Serial.printf` had an unescaped newline.
- Firmware **1.1.0** flashed and verified on hardware (COM13).

## 1.4.0 — `versionCode 5` (2026-08-16)

- True CO2 from the SCD40 (NDIR) is transmitted over BLE and shown in the app, separate from
  the SGP30's `eco2` estimate. Previously only the estimate existed, which reads as a
  measurement and is not one.

## 1.3.0 — `versionCode 4` (2026-08-15)

- Personalized Risk Score, Predictive Alert (15–30 min), Asthma Action Plan, SOS flow with a
  BLE SOS characteristic and consent-gated location, and inhaler logging in the symptom diary.
- Supabase migration `003_care_and_sos.sql`.

## 1.2.0 — `versionCode 3` (2026-08-15)

- All client hardcodes removed: device id resolves at runtime, map key and API base come from
  the environment. `check:hardcode` guard added to stop them coming back.
- Analytics API: daily summary, exposure timeline, weekly history, data quality, baseline,
  pattern, privacy and device registry.

## 1.1.0 — `versionCode 2` (2026-08-14)

- Design-system refresh: gradients, soft elevation, hero status card.

## 1.0.0 — `versionCode 1` (2026-08-13)

- First full app: 20 screens, BLE pairing, Longdo Map, Supabase auth.
