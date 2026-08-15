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

void initBLE();
// Push one telemetry sample. sensorsValid = data.pms_valid && data.scd40_valid (PM/T/RH ready).
// battery_pct: 0-100 from the fuel gauge/ADC; quality_score: on-device 0..1 estimate.
// tvoc (ppb) / eco2 (ppm, estimated) are read from data.tvoc/data.eco2 and included only
// when data.sgp30_valid — never a fabricated value during warmup or when the chip is absent.
void bleNotifyTelemetry(const SensorData& data, bool sensorsValid, int battery_pct, float quality_score);
// sensor_status: PM validity only ("OK"/"ERROR"). sgp30_status: "OK"|"WARMUP"|"ERROR",
// see portable.ino's sgp30StatusString().
void bleNotifyStatus(int battery_pct, const char* sensor_status, const char* sgp30_status, const char* fw_version);
bool bleIsConnected();

#endif // BLE_H
