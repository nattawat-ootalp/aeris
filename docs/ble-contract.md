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
| Device status | `c1b0ae02-9e57-4a3d-9f2a-0e1a2b3c4d02` | Notify + Read | JSON `{"battery":82,"sensor_status":"OK","fw":"1.0.0"}` |
| Command | `c1b0ae03-9e57-4a3d-9f2a-0e1a2b3c4d03` | Write | JSON `{"cmd":"interval","sec":5}` \| `{"cmd":"identify"}` |

### Telemetry JSON (Aeris data contract §4, minus device_id — BLE already identifies the device)
```json
{"pm25":34.2,"temperature":31.2,"humidity":71.4,"battery":82,"sensor_status":"OK","quality_score":0.96,"ts":1755090000}
```
- `sensor_status`: `OK` | `WARMUP` | `ERROR`. If PM invalid, firmware sends `sensor_status:"ERROR"` and **omits `pm25`** (never a fabricated value) — the app/backend then produce No Data, not a PM caution.
- `ts`: device epoch seconds (phone re-stamps with its own clock on ingest if device clock is unset).
- MTU: request ≥185 so the JSON fits one notification; if MTU is small the firmware still keeps the JSON <180 bytes.

## Phone gateway responsibilities
1. Show live telemetry from the Notify characteristic immediately (local, works with no internet).
2. Re-attach `device_id` (the paired device's stable id) + ISO timestamp and POST to `/ingest/portable` for history/decision.
3. On disconnect: show **No Data / reconnecting**, never the last value as "current".

## App BLE stack
`react-native-ble-plx` via an Expo config plugin + a custom dev client (BLE does not work in Expo Go).
iOS: `NSBluetoothAlwaysUsageDescription`. Android: `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` runtime permissions.
