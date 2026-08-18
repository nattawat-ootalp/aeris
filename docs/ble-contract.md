# Aeris Portable — BLE GATT Contract

The single source of truth shared by the **portable firmware** and the **mobile app**.
Portable → BLE → phone (gateway) → HTTPS `/ingest/portable` → backend. Keep both sides in sync.
Neither hop is assumed to be up: see "Buffered replay" below.

## Advertising
- Device name: `Aeris-P<4hex>` (e.g. `Aeris-P0A1`). The `<4hex>` is the last 2 bytes of the MAC.
- Advertises the Environmental Service UUID below so the app can filter to Aeris devices only.

## GATT services & characteristics (custom 128-bit UUIDs)

**Environmental Service** `c1b0ae00-9e57-4a3d-9f2a-0e1a2b3c4d00`

| Characteristic | UUID | Props | Payload |
|---|---|---|---|
| Telemetry | `c1b0ae01-9e57-4a3d-9f2a-0e1a2b3c4d01` | Notify + Read | JSON (below), pushed every 5 s (interval BLE, §3.2) |
| Device status | `c1b0ae02-9e57-4a3d-9f2a-0e1a2b3c4d02` | Notify + Read | JSON `{"battery":82,"sensor_status":"OK","fw":"1.0.0","sgp30":"OK"}` |
| Command | `c1b0ae03-9e57-4a3d-9f2a-0e1a2b3c4d03` | Write | JSON `{"cmd":"interval","sec":5}` \| `{"cmd":"identify"}` |
| SOS | `c1b0ae04-9e57-4a3d-9f2a-0e1a2b3c4d04` | Notify + Read | JSON `{"event":"sos","ts":1755090000}` — emitted once per button press |

### Telemetry JSON (Aeris data contract §4, minus device_id — BLE already identifies the device)
```json
{"pm25":34.2,"temperature":31.2,"humidity":71.4,"co2":812,"tvoc":120,"eco2":450,"battery":82,"sensor_status":"OK","quality_score":0.96,"ts":1755090000}
```

| Field | Type | Unit | Omitted when |
|---|---|---|---|
| `pm25` | float | µg/m³ | PMS7003 invalid/no data |
| `temperature` | float | °C | SCD40 invalid/no data |
| `humidity` | float | %RH | SCD40 invalid/no data |
| `co2` | int | ppm | SCD40 invalid/no data |
| `tvoc` | int | ppb | SGP30 invalid — no data / still in 15 s warmup / chip absent |
| `eco2` | int | ppm | SGP30 invalid — no data / still in 15 s warmup / chip absent |
| `battery` | int | % | never (placeholder if no fuel gauge wired) |
| `sensor_status` | string | — | never |
| `quality_score` | float | 0..1 | never |
| `ts` | int | seconds since device boot | never |
| `buf` | bool | — | live readings — present (`true`) only on a replayed sample |

- `sensor_status`: `OK` | `WARMUP` | `ERROR`, reflects **PM validity only**. If PM invalid, firmware sends `sensor_status:"ERROR"` and **omits `pm25`** (never a fabricated value) — the app/backend then produce No Data, not a PM caution. SGP30 health is **never** folded into `sensor_status` (see Device status below) — an absent/warming-up SGP30 must not suppress a perfectly good PM reading.
- `co2`: from the **SCD40**, a **true NDIR CO2 measurement**. Sent with `temperature`/`humidity`
  and omitted with them when the SCD40 is invalid. It is a different quantity from `eco2` below
  and the two must never be merged, substituted for each other, or shown as one value: the app
  labels this one plainly "CO2" and keeps `eco2` marked "(estimated)".
- `tvoc` / `eco2`: from the **SGP30**. **`eco2` is an *estimated* CO2-equivalent derived from VOC sensing — it is NOT a real CO2 measurement.** The SCD40's true NDIR CO2 is transmitted separately as `co2` above; apps/backends must not label `eco2` as "CO2" or treat it as interchangeable with the real reading. Both fields are **omitted entirely** (not sent as `0` or `null`) whenever the SGP30 is invalid — during its 15 s power-on warmup, after an I2C bus recovery re-warmup, or when the chip is not physically present on the bus. Omission is the sole "no data" signal; consumers must render "no data", never treat a missing field as 0.
- `ts`: **seconds since the device booted** (`millis()/1000`), not an epoch. The portable has
  no RTC and no network, so it cannot know the date. The phone recovers the real capture time
  by anchoring this counter to its own clock on connect (`mobile/src/lib/deviceClock.ts`) and
  re-anchoring when `ts` jumps backwards, which is what a reboot looks like. The phone must
  NOT simply stamp the arrival time: that is indistinguishable from the truth for a live
  reading and completely wrong for a replayed one.
- MTU: request ≥185 so the JSON fits one notification; if MTU is small the firmware still keeps the JSON <180 bytes. Measured worst case (all fields present including `co2`, longest string/decimal cases): ~170 bytes.

### Device status JSON
```json
{"battery":82,"sensor_status":"OK","fw":"1.2.0","sgp30":"OK","buffered":0,"dropped":0}
```
- `buffered`: samples taken while no phone was connected that are still waiting to be replayed.
- `dropped`: samples the ring buffer had to evict since boot because it filled up. Non-zero means
  the record has a hole the device could not avoid. It is reported rather than left implicit —
  a gap the phone cannot tell apart from "the device was switched off" is worse than a number.
- `sgp30`: `OK` | `WARMUP` | `ERROR` — SGP30 chip health, separate from `sensor_status` (which stays PM-only). Firmware cannot distinguish "still warming up" from "chip not found" via the driver alone, so it uses a boot-window heuristic: not-ready within the first 20 s after boot reports `WARMUP`; not-ready after that (including a mid-run I2C-recovery re-warmup) reports `ERROR`. This means a bus-recovery event can under-report as `ERROR` instead of `WARMUP` — treat `ERROR` as "no current SGP30 data", not necessarily "hardware fault".

### Buffered replay

The portable measures every 5 s whether or not a phone is listening. A reading nobody received
is a hole in the record, not a non-event — the device is the only place it exists, and once
overwritten it is gone. So samples taken while disconnected (and any whose notification the BLE
stack refuses) are held in a ring buffer and replayed when a phone reconnects.

- **Capacity: 720 samples — one hour at the 5 s cadence** (`TELEMETRY_BUFFER_CAPACITY` in
  `firmware/portable/buffer.h`). Stored packed, ~20 KB of SRAM; buffering the serialized JSON
  instead would cost roughly six times that for the same hour.
- **When full, the OLDEST sample is evicted** and counted in `dropped` above. Dropping the newest
  instead would mean a phone reconnects to an hour of history that stops before the present,
  which is the more misleading of the two failures.
- **Replay starts ~1.5 s after connect**, once the phone has had time to finish discovery and
  subscribe. It is rate-limited to a couple of notifications per firmware loop pass (~40/s), so a
  full ring drains in about 20 s and the live 5 s sample keeps flowing throughout.
- **A replayed frame is byte-identical to the live one it would have been, plus `"buf":true`.**
  Every omit-when-invalid rule above still holds: validity is carried through the buffer as a
  flag, never as a zero, so a replayed sample omits exactly the fields the live one would have.
- **The phone must not display a `buf` sample as the current reading.** It describes the air at
  an earlier moment; showing it as "now" would present a measurement from half an hour ago as the
  room the user is standing in. It is still real data and still goes to the backend — the app
  stores it and skips the live-reading update (`mobile/src/state/portable.tsx`).
- A sample is removed from the buffer only after the radio has accepted the notification, so a
  refused notify leaves it queued rather than consuming it.

The phone has a matching buffer of its own for the next hop: readings it cannot upload go to an
AsyncStorage outbox (`mobile/src/lib/outbox.ts`) and are replayed through
`POST /ingest/portable/batch`. Between the two, a reading survives both the phone being out of
range of the device and the device-plus-phone being out of range of the network.

### SOS characteristic

```json
{"event":"sos","ts":1755090000}
```

The portable reports **only that the user pressed the button**, and when. It deliberately
carries no severity, no classification and no location:

- the device cannot assess a medical situation and must never appear to (TDD §1.2, §14);
- location belongs to the phone, which holds the user's `location_sharing` consent. The
  firmware has no GPS and no consent state, so it never sends coordinates;
- one press produces exactly one notification, however long the button is held
  (`SOS_BUTTON_HOLD_MS` debounce). Holding does not escalate anything.

The characteristic value is also set while disconnected, so a phone that connects afterwards
can READ the last event rather than losing it. Builds with no button wired leave
`SOS_BUTTON_PIN` undefined and never emit this event.

On receiving it the phone: records the event via `POST /sos` (which applies the user's
location consent server-side), shows the user's own action plan, and shows the contacts the
user marked `notify_on_sos`. **Nothing is sent to anyone automatically.**

## Building and flashing the portable

Board: **ESP32-S3**. Flash with the Arduino IDE's bundled CLI:

```
arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc firmware/portable
arduino-cli upload -p COM13 --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc firmware/portable
```

`CDCOnBoot=cdc` is **required**, not cosmetic. The board option defaults to *Disabled*, which
routes `Serial` to the UART0 pins instead of USB — the sketch then runs correctly but prints
nothing to the USB port, which looks exactly like a failed flash. Keep the same option on
compile and upload.

`firmware/portable/config.h` is gitignored; copy `config.example.h` to it before the first
build. Define `SOS_BUTTON_PIN` there only on units that actually have the button wired.

Verified on 2026-08-15: telemetry frames are 143–145 bytes with every field present, well
inside the 180-byte budget above.

## Phone gateway responsibilities
1. Show live telemetry from the Notify characteristic immediately (local, works with no internet).
   Subscribe to the SOS characteristic at the same time — an SOS raised while the app is in the
   background must still reach `POST /sos`.
2. Re-attach `device_id` (the paired device's stable id) + ISO timestamp and POST to `/ingest/portable` for history/decision.
3. On disconnect: show **No Data / reconnecting**, never the last value as "current".

## App BLE stack
`react-native-ble-plx` via an Expo config plugin + a custom dev client (BLE does not work in Expo Go).
iOS: `NSBluetoothAlwaysUsageDescription`. Android: `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` runtime permissions.
