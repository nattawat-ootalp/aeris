// Aeris Portable — BLE GATT layer. Contract: docs/ble-contract.md (keep both in sync).
#ifndef BLE_H
#define BLE_H

#include <Arduino.h>
#include "sensors.h"

// Environmental Service + characteristics (docs/ble-contract.md)
#define BLE_SERVICE_UUID        "c1b0ae00-9e57-4a3d-9f2a-0e1a2b3c4d00"
#define BLE_CHAR_TELEMETRY_UUID "c1b0ae01-9e57-4a3d-9f2a-0e1a2b3c4d01"
#define BLE_CHAR_STATUS_UUID    "c1b0ae02-9e57-4a3d-9f2a-0e1a2b3c4d02"
#define BLE_CHAR_COMMAND_UUID   "c1b0ae03-9e57-4a3d-9f2a-0e1a2b3c4d03"
#define BLE_CHAR_SOS_UUID       "c1b0ae04-9e57-4a3d-9f2a-0e1a2b3c4d04"

void initBLE();
// Push one telemetry sample. sensorsValid = data.pms_valid && data.scd40_valid (PM/T/RH ready).
// battery_pct: 0-100 from the fuel gauge/ADC; quality_score: on-device 0..1 estimate.
// tvoc (ppb) / eco2 (ppm, estimated) are read from data.tvoc/data.eco2 and included only
// when data.sgp30_valid — never a fabricated value during warmup or when the chip is absent.
void bleNotifyTelemetry(const SensorData& data, bool sensorsValid, int battery_pct, float quality_score);
// Hand buffered samples to a reconnected phone, a few per call. Call every loop; it is a
// no-op while disconnected or once the buffer is empty. Replayed frames carry "buf":true so
// the phone stores them as history and never shows them as the current reading.
void bleServiceBuffer();
// sensor_status: PM validity only ("OK"/"ERROR"). sgp30_status: "OK"|"WARMUP"|"ERROR",
// see portable.ino's sgp30StatusString(). Also reports `buffered` (samples waiting for a
// phone) and `dropped` (samples the ring had to evict since boot).
void bleNotifyStatus(int battery_pct, const char* sensor_status, const char* sgp30_status, const char* fw_version);
// Emergency event raised by the user pressing the SOS button on the portable.
// The firmware only reports THAT the button was pressed — it never assesses the situation.
// The phone is what records the event, applies the user's consent settings and shows their
// own action plan (see docs/ble-contract.md, "SOS").
void bleNotifySos(uint32_t press_ts_sec);
// Debounced read of the SOS button on SOS_BUTTON_PIN. Call every loop; returns true once
// per press. Always returns false when SOS_BUTTON_PIN is not defined in config.h.
bool sosButtonPressed();
bool bleIsConnected();

#endif // BLE_H
