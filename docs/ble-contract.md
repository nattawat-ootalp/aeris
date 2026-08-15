# Aeris Portable — BLE GATT Contract

The single source of truth shared by the **portable firmware** and the **mobile app**.
Portable → BLE → phone (gateway) → HTTPS `/ingest/portable` → backend. Keep both sides in sync.

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

### Telemetry JSON (Aeris data contract §4, minus device_id — BLE already identifies the device)
```json
{"pm25":34.2,"temperature":31.2,"humidity":71.4,"tvoc":120,"eco2":450,"battery":82,"sensor_status":"OK","quality_score":0.96,"ts":1755090000}
```

| Field | Type | Unit | Omitted when |
|---|---|---|---|
| `pm25` | float | µg/m³ | PMS7003 invalid/no data |
| `temperature` | float | °C | SCD40 invalid/no data |
| `humidity` | float | %RH | SCD40 invalid/no data |
| `tvoc` | int | ppb | SGP30 invalid — no data / still in 15 s warmup / chip absent |
| `eco2` | int | ppm | SGP30 invalid — no data / still in 15 s warmup / chip absent |
| `battery` | int | % | never (placeholder if no fuel gauge wired) |
| `sensor_status` | string | — | never |
| `quality_score` | float | 0..1 | never |
| `ts` | int | epoch seconds | never |

- `sensor_status`: `OK` | `WARMUP` | `ERROR`, reflects **PM validity only**. If PM invalid, firmware sends `sensor_status:"ERROR"` and **omits `pm25`** (never a fabricated value) — the app/backend then produce No Data, not a PM caution. SGP30 health is **never** folded into `sensor_status` (see Device status below) — an absent/warming-up SGP30 must not suppress a perfectly good PM reading.
- `tvoc` / `eco2`: from the **SGP30**. **`eco2` is an *estimated* CO2-equivalent derived from VOC sensing — it is NOT a real CO2 measurement.** The SCD40 on the same board measures true CO2 via NDIR but is currently not transmitted over BLE; apps/backends must not label `eco2` as "CO2" or treat it as interchangeable with a real CO2 reading. Both fields are **omitted entirely** (not sent as `0` or `null`) whenever the SGP30 is invalid — during its 15 s power-on warmup, after an I2C bus recovery re-warmup, or when the chip is not physically present on the bus. Omission is the sole "no data" signal; consumers must render "no data", never treat a missing field as 0.
- `ts`: device epoch seconds (phone re-stamps with its own clock on ingest if device clock is unset).
- MTU: request ≥185 so the JSON fits one notification; if MTU is small the firmware still keeps the JSON <180 bytes. Measured worst case (all fields present, longest string/decimal cases): ~158 bytes.

### Device status JSON
```json
{"battery":82,"sensor_status":"OK","fw":"1.0.0","sgp30":"OK"}
```
- `sgp30`: `OK` | `WARMUP` | `ERROR` — SGP30 chip health, separate from `sensor_status` (which stays PM-only). Firmware cannot distinguish "still warming up" from "chip not found" via the driver alone, so it uses a boot-window heuristic: not-ready within the first 20 s after boot reports `WARMUP`; not-ready after that (including a mid-run I2C-recovery re-warmup) reports `ERROR`. This means a bus-recovery event can under-report as `ERROR` instead of `WARMUP` — treat `ERROR` as "no current SGP30 data", not necessarily "hardware fault".

## Phone gateway responsibilities
1. Show live telemetry from the Notify characteristic immediately (local, works with no internet).
2. Re-attach `device_id` (the paired device's stable id) + ISO timestamp and POST to `/ingest/portable` for history/decision.
3. On disconnect: show **No Data / reconnecting**, never the last value as "current".

## App BLE stack
`react-native-ble-plx` via an Expo config plugin + a custom dev client (BLE does not work in Expo Go).
iOS: `NSBluetoothAlwaysUsageDescription`. Android: `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` runtime permissions.
