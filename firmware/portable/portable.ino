// ============================================================
//  Aeris Portable — Main Firmware (ESP32-S3)
//  Personal Environmental Exposure — BLE-only (no WiFi/MQTT)
//
//  Readings taken while no phone is connected are held in a ring buffer (buffer.h) and
//  replayed on reconnect, so walking away from the phone leaves a gap in delivery but not in
//  the record. See docs/ble-contract.md, "Buffered replay".
//
//  Sensors reused from AirSentinel: PMS7003 (PM2.5/PM10), SCD40 (Temp/Hum/CO2), SGP30 (TVOC/eCO2).
//  Portable reports pm25/temperature/humidity/tvoc/eco2/battery/sensor_status/
//  quality_score over BLE. tvoc/eco2 (SGP30, estimated CO2-equivalent) are included only
//  when valid. True CO2 from the SCD40 (NDIR) is still NOT sent over BLE. See docs/ble-contract.md.
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

#define FW_VERSION "1.2.0"
// No fuel gauge wired in this MVP build — report a fixed placeholder rather than a
// fabricated reading; a future revision should read a real ADC/fuel-gauge here.
#define BATTERY_PLACEHOLDER_PCT 100

static float onDeviceQualityScore(const SensorData& data) {
  // simple device-side estimate; the backend's §5.1 gate is authoritative
  // Deliberately PM/SCD40 only — quality_score feeds the PM-driven decision path, and the
  // SGP30 is optional/absent hardware on this unit; letting a missing SGP30 drag the score
  // down would degrade every PM decision for no medical benefit. See docs/ble-contract.md.
  if (!data.pms_valid) return 0.0f;
  if (!data.scd40_valid) return 0.6f;
  return 1.0f;
}

// SGP30 needs ~15 s warmup (sensors.cpp). isSensorReady() can't distinguish "warming up"
// from "chip absent/not found", so treat !ready inside this boot-window grace period as
// WARMUP and anything after it as ERROR. Conservative by design: a mid-run I2C-recovery
// re-warmup (see sensors.cpp recoverI2CBus()) will report ERROR rather than a false WARMUP/OK —
// never claims health it can't confirm. See docs/ble-contract.md.
#define SGP30_WARMUP_GRACE_MS 20000
static const char* sgp30StatusString(const SensorData& data) {
  if (data.sgp30_valid) return "OK";
  if (!isSensorReady() && millis() < SGP30_WARMUP_GRACE_MS) return "WARMUP";
  return "ERROR";
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

  // SOS button: report the press immediately, ahead of the scheduled notifies. The device
  // makes no judgement about the press — the phone records it under the user's settings.
  if (sosButtonPressed()) {
    Serial.println("[System] SOS button pressed — notifying phone");
    bleNotifySos((uint32_t)(millis() / 1000));
  }

  // Hand over anything measured while no phone was listening. Rate-limited inside, so this
  // runs alongside the live sample rather than blocking it.
  bleServiceBuffer();

  if (now - lastStatusNotify >= STATUS_NOTIFY_INTERVAL_MS) {
    lastStatusNotify = now;
    const char* status = latestData.pms_valid ? "OK" : "ERROR";
    bleNotifyStatus(BATTERY_PLACEHOLDER_PCT, status, sgp30StatusString(latestData), FW_VERSION);
  }

  delay(50);
}
