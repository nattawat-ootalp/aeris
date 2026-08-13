// reused from AirSentinel
// ============================================================
//  AirSentinel — Main Firmware (ESP32-S3)
//  Hyperlocal Air Quality Monitoring Platform
//  Phase 1 — Version 1.4.2
//
//  ระบบตรวจวัดคุณภาพอากาศแบบละเอียดรายพื้นที่
//  เซนเซอร์: PMS7003 (PM2.5/PM10), SCD40 (CO2/Temp/Hum), SGP30 (TVOC)
//  การเชื่อมต่อ: HiveMQ Cloud (MQTTS port 8883)
//  Edge AI: AQI Classification + Anomaly Detection (Z-score)
// ============================================================

#include "sensors.h"
#include "model.h"
#include "mqtt.h"

// ===== Timing Constants =====
#define TELEMETRY_INTERVAL_MS   30000   // ส่ง telemetry ทุก 30 วินาที
#define HEALTH_INTERVAL_MS     300000   // ส่ง device health ทุก 5 นาที
#define SENSOR_READ_INTERVAL_MS  5000   // อ่านเซนเซอร์ทุก 5 วินาที (SCD40 update rate)

// ===== Timing Trackers =====
static unsigned long lastTelemetryTime = 0;
static unsigned long lastHealthTime    = 0;
static unsigned long lastSensorRead    = 0;

// ===== Latest Sensor Data =====
static SensorData latestData = {};
static ModelResult latestResult = {};

// ===== Anomaly state =====
// ส่ง alert ทันทีที่เจอ anomaly ในรอบ inference (5 วิ) — ไม่รอรอบ telemetry (30 วิ)
// anomalyAlerted = edge-trigger กันส่งซ้ำทุก 5 วิระหว่างที่ anomaly ยังค้าง
// (จะรีเซ็ตเมื่อ anomaly หาย พร้อมส่งใหม่ถ้าเกิดอีก; backend ยัง de-dup 15 นาทีอีกชั้น)
static bool anomalyAlerted = false;


void setup() {
  Serial.begin(115200);
  delay(3000);  // รอ Serial Monitor พร้อม

  Serial.println("╔══════════════════════════════════════════╗");
  Serial.println("║     AirSentinel — Air Quality Node       ║");
  Serial.println("║     Phase 1 · Firmware v1.4.2            ║");
  Serial.println("╚══════════════════════════════════════════╝");
  Serial.println();

  // 1. เริ่มต้นเซนเซอร์ (PMS7003 + SCD40 + SGP30)
  initSensors();

  // 2. เริ่มต้นโมเดล AI (Rule-based classification + Z-score anomaly)
  initModel();

  // 3. เชื่อมต่อ WiFi
  initWiFi();

  // 4. เชื่อมต่อ MQTT (HiveMQ Cloud)
  initMQTT();

  Serial.println();
  Serial.println("[System] All systems initialized. Starting main loop...");
  Serial.println("-------------------------------");
}


void loop() {
  unsigned long now = millis();

  // ===== 1. MQTT keep-alive & reconnect =====
  mqttLoop();

  // ===== 2. อ่านค่าเซนเซอร์ (ทุก 5 วินาที) =====
  if (now - lastSensorRead >= SENSOR_READ_INTERVAL_MS) {
    lastSensorRead = now;
    latestData = readSensors();

    // รัน Edge AI inference
    latestResult = runInference(latestData);

    // ===== ส่ง Anomaly Alert ทันที (ไม่รอรอบ telemetry 30 วิ) =====
    // edge-trigger: ส่งครั้งเดียวตอน anomaly เริ่มเกิด แล้วรอจนหายก่อนส่งใหม่
    if (latestResult.anomaly_detected) {
      if (!anomalyAlerted && isMQTTConnected()) {
        const char* s = (latestResult.anomaly_sensor && latestResult.anomaly_sensor[0])
                        ? latestResult.anomaly_sensor : "pm2_5";
        publishAlert(s, latestResult.anomaly_value, 0, "Edge_AI", "hazardous", true);
        anomalyAlerted = true;
        Serial.printf("[Alert] Anomaly sent immediately: %s=%.1f\n", s, latestResult.anomaly_value);
      }
    } else {
      anomalyAlerted = false;  // anomaly หายแล้ว — พร้อมส่งครั้งใหม่ถ้าเกิดอีก
    }

    // แสดงข้อมูลบน Serial Monitor (debug)
    printSensorData(latestData);
  }

  // ===== 3. ส่ง Telemetry (ทุก 30 วินาที) =====
  if (now - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = now;

    if (isMQTTConnected()) {
      publishTelemetry(latestData, latestResult.aqi_class, latestResult.anomaly_detected);
    } else {
      Serial.println("[System] MQTT not connected — skipping telemetry");
    }

    // ===== 4. ตรวจสอบเงื่อนไข Alert =====
    // ส่ง alert เมื่อค่าเกิน threshold ต่อเนื่อง 2 รอบ (60 วินาที)
    if (checkAlertConditions(latestData)) {
      // PM2.5 alert
      if (latestData.pms_valid && latestData.pm2_5 > 37.5f) {
        const char* severity = latestData.pm2_5 > 75.0f ? "hazardous" : "unhealthy";
        publishAlert("pm2_5", latestData.pm2_5, 37.5f, "PCD_Thailand", severity, false);
      }
      // CO2 alert
      if (latestData.scd40_valid && latestData.co2 > 2000.0f) {
        publishAlert("co2", latestData.co2, 2000.0f, "ASHRAE_62.1", "unhealthy", false);
      }
      // TVOC alert
      if (latestData.sgp30_valid && latestData.tvoc > 660.0f) {
        publishAlert("tvoc", latestData.tvoc, 660.0f, "UBA_Germany", "unhealthy", false);
      }
    }

    // (anomaly ส่งทันทีในรอบ inference 5 วิด้านบนแล้ว — ไม่ต้องส่งซ้ำที่รอบ 30 วิ)
  }

  // ===== 6. ส่ง Device Health (ทุก 5 นาที) =====
  if (now - lastHealthTime >= HEALTH_INTERVAL_MS) {
    lastHealthTime = now;

    if (isMQTTConnected()) {
      publishHealth();
    }
  }

  // Small delay เพื่อลด CPU load
  delay(100);
}