// ============================================================
//  Aeris Combined — one board, both ingestion pipelines (ESP32-S3)
//
//  WHAT THIS IS FOR
//  ----------------
//  The portable and station firmwares each prove one half of the system. Neither proves that
//  the two halves agree, because they run on different boards reading different air: any
//  difference between what the app shows and what the dashboard shows could always be the
//  rooms, not the code.
//
//  This build removes that excuse. One set of sensors is read once, and the SAME sample is
//  sent out both paths:
//
//      readSensors()
//         ├── BLE  ──▶ phone ──▶ POST /ingest/portable   ──▶ source="portable"
//         └── MQTT ──▶ HiveMQ ─▶ bridge ─▶ POST /webhook/telemetry ──▶ source="station"
//
//  Both land in the same InfluxDB measurement under two device ids, so the two pipelines can
//  be compared reading for reading. If a number differs, the difference is in the pipeline —
//  which is exactly what a demo of the pipeline should be able to show.
//
//  The two paths keep their own cadence, buffer and failure handling, because that is what
//  is being demonstrated. BLE notifies every 5 s and MQTT publishes every 30 s, so a station
//  frame lines up with every sixth portable frame rather than with a separate measurement.
//
//  ONE BOX, TWO DEVICE IDS
//  -----------------------
//  The BLE path is identified by the advertising name the phone pairs with; the MQTT path by
//  NODE_ID. They are deliberately different: the backend is being shown that it treats two
//  independent sources correctly, and merging them here would hide the thing under test.
//
//  RADIO AND POWER
//  ---------------
//  BLE and WiFi share one 2.4 GHz radio and are arbitrated by the ESP32's coexistence layer.
//  It works, but it costs airtime and current that neither single-path build pays, and this
//  unit has already been rebooting under load. Free heap is printed on every status line for
//  that reason — a fall towards zero is the signature to watch for, and it is the one thing
//  no dashboard downstream can see.
//
//  Sensors: PMS7003 (PM2.5/PM10), SCD40 (CO2/Temp/Hum), SGP30 (TVOC/eCO2).
// ============================================================

// FW_VERSION comes from mqtt.h, which every translation unit here includes. Defining it in
// this file instead would leave mqtt.cpp publishing a different number than the BLE status
// reports — one binary must not describe itself two ways.

#include "sensors.h"
#include "ble.h"
#include "mqtt.h"
#include "model.h"
#include "ble_buffer.h"
#include "station_buffer.h"

// ===== Timing =====
// Each path keeps the cadence its own firmware uses. Aligning them would make the comparison
// tidier and the demonstration weaker: the point is that both pipelines work as they are.
#define SENSOR_READ_INTERVAL_MS   5000    // SCD40's own update rate
#define BLE_NOTIFY_INTERVAL_MS    5000    // portable cadence
#define TELEMETRY_INTERVAL_MS    30000    // station cadence
#define STATUS_NOTIFY_INTERVAL_MS 30000   // BLE device status
#define HEALTH_INTERVAL_MS      300000    // MQTT device health
#define PIPELINE_REPORT_MS       10000    // the Serial board below

static unsigned long lastSensorRead = 0;
static unsigned long lastBleNotify = 0;
static unsigned long lastTelemetry = 0;
static unsigned long lastStatusNotify = 0;
static unsigned long lastHealth = 0;
static unsigned long lastReport = 0;

static SensorData latestData = {};
static ModelResult latestResult = {};
static bool anomalyAlerted = false;

// Counted here rather than inferred from the logs: a demo needs a number that can be read out
// loud, and "42 sent each way" is the claim this firmware exists to support.
static uint32_t bleSent = 0;
static uint32_t mqttSent = 0;

// No fuel gauge on this build. A fixed placeholder is reported rather than a fabricated
// reading — the same choice portable.ino makes, for the same reason.
#define BATTERY_PLACEHOLDER_PCT 100

static float onDeviceQualityScore(const SensorData& data) {
  // Device-side estimate only; the backend's §5.1 gate is authoritative. PM/SCD40 only: the
  // SGP30 is optional hardware, and letting a missing one drag the score down would degrade
  // every PM-driven decision for no benefit.
  if (!data.pms_valid) return 0.0f;
  if (!data.scd40_valid) return 0.6f;
  return 1.0f;
}

// isSensorReady() cannot tell "warming up" from "absent", so anything before the grace period
// is WARMUP and anything after it is ERROR. Conservative on purpose: a mid-run I2C recovery
// re-warms the SGP30 and will report ERROR rather than a false OK.
#define SGP30_WARMUP_GRACE_MS 20000
static const char* sgp30StatusString(const SensorData& data) {
  if (data.sgp30_valid) return "OK";
  if (!isSensorReady() && millis() < SGP30_WARMUP_GRACE_MS) return "WARMUP";
  return "ERROR";
}

// The demo readout: both paths side by side, from one measurement.
static void printPipelineReport() {
  Serial.println();
  Serial.println("┌─ Aeris pipeline ────────────────────────────────────────────");
  if (latestData.pms_valid) {
    Serial.printf("│  measured   PM2.5 %.1f  PM10 %.1f", latestData.pm2_5, latestData.pm10);
  } else {
    Serial.print("│  measured   PM sensor INVALID");
  }
  if (latestData.scd40_valid) {
    Serial.printf("  CO2 %.0f  %.1fC  %.0f%%", latestData.co2, latestData.temperature,
                  latestData.humidity);
  }
  if (latestData.sgp30_valid) Serial.printf("  TVOC %.0f", latestData.tvoc);
  Serial.println();

  Serial.printf("│  BLE  →app  %-12s sent %-5u buffered %-4u lost %u\n",
                bleIsConnected() ? "CONNECTED" : "advertising",
                (unsigned)bleSent, (unsigned)bleBufferCount(), (unsigned)bleBufferDropped());
  Serial.printf("│  MQTT →cloud %-11s sent %-5u buffered %-4u lost %u\n",
                isMQTTConnected() ? "CONNECTED" : "offline",
                (unsigned)mqttSent, (unsigned)stationBufferCount(),
                (unsigned)stationBufferDropped());
  // Both radios plus TLS on one chip; this is the number that moves before a brownout or an
  // allocation failure takes the board down, and nothing downstream can see it.
  Serial.printf("│  heap       %u bytes free (min %u since boot)\n",
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMinFreeHeap());
  Serial.println("└─────────────────────────────────────────────────────────────");
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println("==============================================");
  Serial.println("  Aeris Combined — portable + station");
  Serial.println("  Firmware " FW_VERSION);
  Serial.println("  BLE id : Aeris-P<suffix>   (source=portable)");
  Serial.println("  MQTT id: " NODE_ID "          (source=station)");
  Serial.println("==============================================");

  initSensors();
  initModel();

  // BLE first, then WiFi. NimBLE's controller wants its allocation before the WiFi stack and
  // TLS take theirs; the other order is what runs out of heap on a board this size.
  initBLE();
  initWiFi();
  initMQTT();

  Serial.println();
  Serial.println("[System] Both pipelines up. One measurement, two paths.");
}

void loop() {
  unsigned long now = millis();

  // ── Station path upkeep: reconnect, keepalive, and replay of anything the broker missed ──
  mqttLoop();
  mqttServiceBuffer();

  // ── One measurement, feeding both paths ──
  if (now - lastSensorRead >= SENSOR_READ_INTERVAL_MS) {
    lastSensorRead = now;
    latestData = readSensors();
    latestResult = runInference(latestData);

    // Edge-triggered so a persisting anomaly is reported once rather than every cycle. The
    // backend de-duplicates as well; this keeps the radio quiet, not the record clean.
    if (latestResult.anomaly_detected) {
      if (!anomalyAlerted && isMQTTConnected()) {
        const char* s = (latestResult.anomaly_sensor && latestResult.anomaly_sensor[0])
                        ? latestResult.anomaly_sensor : "pm2_5";
        publishAlert(s, latestResult.anomaly_value, 0, "Edge_AI", "hazardous", true);
        anomalyAlerted = true;
      }
    } else {
      anomalyAlerted = false;
    }
  }

  // ── Portable path: BLE notify every 5 s ──
  if (now - lastBleNotify >= BLE_NOTIFY_INTERVAL_MS) {
    lastBleNotify = now;
    bleNotifyTelemetry(latestData, latestData.pms_valid, BATTERY_PLACEHOLDER_PCT,
                       onDeviceQualityScore(latestData));
    bleSent++;
  }

  if (sosButtonPressed()) {
    // Reported, not judged: the phone records the press under the user's own settings.
    Serial.println("[System] SOS button pressed — notifying phone");
    bleNotifySos((uint32_t)(millis() / 1000));
  }

  // Hand over anything measured while no phone was listening. Rate-limited inside, so it
  // shares the loop with the live sample rather than blocking it.
  bleServiceBuffer();

  if (now - lastStatusNotify >= STATUS_NOTIFY_INTERVAL_MS) {
    lastStatusNotify = now;
    bleNotifyStatus(BATTERY_PLACEHOLDER_PCT, latestData.pms_valid ? "OK" : "ERROR",
                    sgp30StatusString(latestData), FW_VERSION);
  }

  // ── Station path: MQTT publish every 30 s ──
  if (now - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
    lastTelemetry = now;

    // Called whether or not the broker is reachable: publishTelemetry() buffers what it
    // cannot send, so an outage delays delivery instead of erasing the reading.
    publishTelemetry(latestData, latestResult.aqi_class, latestResult.anomaly_detected);
    mqttSent++;

    if (checkAlertConditions(latestData)) {
      if (latestData.pms_valid && latestData.pm2_5 > 37.5f) {
        const char* severity = latestData.pm2_5 > 75.0f ? "hazardous" : "unhealthy";
        publishAlert("pm2_5", latestData.pm2_5, 37.5f, "PCD_Thailand", severity, false);
      }
      if (latestData.scd40_valid && latestData.co2 > 2000.0f) {
        publishAlert("co2", latestData.co2, 2000.0f, "ASHRAE_62.1", "unhealthy", false);
      }
      if (latestData.sgp30_valid && latestData.tvoc > 660.0f) {
        publishAlert("tvoc", latestData.tvoc, 660.0f, "UBA_Germany", "unhealthy", false);
      }
    }
  }

  if (now - lastHealth >= HEALTH_INTERVAL_MS) {
    lastHealth = now;
    if (isMQTTConnected()) publishHealth();
  }

  if (now - lastReport >= PIPELINE_REPORT_MS) {
    lastReport = now;
    printPipelineReport();
  }

  // 50 ms, the portable's figure rather than the station's 100 ms: BLE has the tighter
  // deadline of the two, and the MQTT keepalive is unbothered by being serviced twice as often.
  delay(50);
}
