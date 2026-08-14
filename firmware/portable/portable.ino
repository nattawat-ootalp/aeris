// ============================================================
//  Aeris Portable — Main Firmware (ESP32-S3)
//  Personal Environmental Exposure — BLE-only (no WiFi/MQTT)
//
//  Sensors reused from AirSentinel: PMS7003 (PM2.5/PM10), SCD40 (Temp/Hum).
//  Portable MVP reports pm25/temperature/humidity/battery/sensor_status/
//  quality_score only — no CO2/TVOC (TDD §3.1). See docs/ble-contract.md.
// ============================================================

#include "sensors.h"
#include "ble.h"

// ===== Timing (interval BLE — TDD §3.2 power management) =====
#define SENSOR_READ_INTERVAL_MS  5000   // matches SCD40 update rate
#define BLE_NOTIFY_INTERVAL_MS   5000   // batch telemetry over BLE every 5s
#define STATUS_NOTIFY_INTERVAL_MS 30000 // device status less frequently

static unsigned long lastSensorRead = 0;
static unsigned long lastBleNotify = 0;
static unsigned long lastStatusNotify = 0;
static SensorData latestData = {};

#define FW_VERSION "1.0.0"
// No fuel gauge wired in this MVP build — report a fixed placeholder rather than a
// fabricated reading; a future revision should read a real ADC/fuel-gauge here.
#define BATTERY_PLACEHOLDER_PCT 100

static float onDeviceQualityScore(const SensorData& data) {
  // simple device-side estimate; the backend's §5.1 gate is authoritative
  if (!data.pms_valid) return 0.0f;
  if (!data.scd40_valid) return 0.6f;
  return 1.0f;
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println("======================================");
  Serial.println("   Aeris Portable — Firmware v" FW_VERSION);
  Serial.println("======================================");

  initSensors();
  initBLE();

  Serial.println("[System] Ready — advertising over BLE, waiting for phone.");
}

void loop() {
  unsigned long now = millis();

  if (now - lastSensorRead >= SENSOR_READ_INTERVAL_MS) {
    lastSensorRead = now;
    latestData = readSensors();
    printSensorData(latestData);
  }

  if (now - lastBleNotify >= BLE_NOTIFY_INTERVAL_MS) {
    lastBleNotify = now;
    float q = onDeviceQualityScore(latestData);
    bleNotifyTelemetry(latestData, latestData.pms_valid, BATTERY_PLACEHOLDER_PCT, q);
  }

  if (now - lastStatusNotify >= STATUS_NOTIFY_INTERVAL_MS) {
    lastStatusNotify = now;
    const char* status = latestData.pms_valid ? "OK" : "ERROR";
    bleNotifyStatus(BATTERY_PLACEHOLDER_PCT, status, FW_VERSION);
  }

  delay(50);
}
