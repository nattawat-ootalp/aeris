// reused from AirSentinel
#include "mqtt.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ===== Global Objects =====
static WiFiClientSecure espClient;
static PubSubClient mqttClient(espClient);

// ===== Reconnect timing =====
static unsigned long lastReconnectAttempt = 0;
#define RECONNECT_INTERVAL_MS 5000
#define RECONNECT_MAX_INTERVAL_MS 60000
// ระยะรอปัจจุบันของ MQTT reconnect — โตเป็นเท่าตัวทุกครั้งที่ล้ม, กลับเป็น 5 วิเมื่อต่อได้
static unsigned long reconnectBackoffMs = RECONNECT_INTERVAL_MS;
// ใช้ตรวจ "เพิ่งหลุด" เพื่อ log สาเหตุครั้งเดียว ไม่ใช่ทุกรอบ loop
static bool wasConnected = false;
// WiFi ก็ต้อง retry ใน loop ด้วย ไม่ใช่แค่ตอน boot: ถ้า AP ยังไม่ขึ้นตอนเปิดเครื่อง
// (หรือหลุดกลางทาง) node จะรอ WiFi กลับมาแล้วต่อเองโดยไม่ต้องกด reset
static unsigned long lastWiFiAttempt = 0;
#define WIFI_RETRY_INTERVAL_MS 15000
// NTP sync ต้องทำหลัง WiFi ติดเสมอ — timestamp ที่ยังไม่ sync จะเป็นปี 1970
static bool ntpSynced = false;

static void reconnectMQTT();
static void syncNTP();

// ===== HiveMQ Cloud Root CA (ISRG Root X1 — Let's Encrypt) =====
// HiveMQ Cloud ใช้ Let's Encrypt certificate
static const char* root_ca =
  "-----BEGIN CERTIFICATE-----\n"
  "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\n"
  "-----END CERTIFICATE-----\n";


// ============================================================
//  MQTT Callback: รับคำสั่งจาก Cloud
// ============================================================
static void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String topicStr = String(topic);
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.printf("[MQTT] Received on %s: %s\n", topic, message.c_str());

  // จัดการคำสั่ง CMD
  if (topicStr.endsWith("/cmd")) {
    if (message == "reboot") {
      Serial.println("[MQTT] Reboot command received!");
      delay(1000);
      ESP.restart();
    }
  }

  // จัดการ OTA Update
  if (topicStr.endsWith("/ota/update")) {
    Serial.println("[MQTT] OTA update command received");
    // TODO: ดาวน์โหลด firmware จาก URL ที่ระบุใน payload
    // สำหรับ Phase 1 จะ log ไว้ก่อน
  }
}


// ============================================================
//  initWiFi() — เชื่อมต่อ WiFi
// ============================================================
void initWiFi() {
  Serial.printf("[WiFi] Connecting to %s...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    syncNTP();
  } else {
    // ไม่ใช่จุดจบ: mqttLoop() จะ retry WiFi ทุก WIFI_RETRY_INTERVAL_MS
    Serial.printf("\n[WiFi] Failed to connect — will keep retrying every %d s\n",
                  WIFI_RETRY_INTERVAL_MS / 1000);
  }
}


// ============================================================
//  syncNTP() — ตั้งเวลาจริงหลัง WiFi ติด (Thailand = UTC+7, ไม่มี DST)
//  จำเป็นสำหรับ timestamp ของ telemetry/alert และสำหรับตรวจ TLS certificate
// ============================================================
static void syncNTP() {
  configTime(7 * 3600, 0, "pool.ntp.org", "time.google.com", "time.nist.gov");
  Serial.print("[NTP] Syncing time");
  struct tm timeinfo;
  int ntpTries = 0;
  while (!getLocalTime(&timeinfo, 500) && ntpTries < 20) {
    Serial.print(".");
    ntpTries++;
  }
  if (ntpTries < 20) {
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
    Serial.printf("\n[NTP] Time synced: %s\n", buf);
    ntpSynced = true;
  } else {
    // ปล่อย ntpSynced เป็น false ไว้ เพื่อให้ลอง sync ใหม่รอบหน้าที่ WiFi ติด
    Serial.println("\n[NTP] Sync failed — timestamps will be marked invalid");
  }
}


// ============================================================
//  isoTimestamp() — เวลาปัจจุบันแบบ ISO 8601 (+07:00) จาก NTP
//  คืน epoch 1970 ถ้า NTP ยังไม่ sync (backend จะ fallback เป็นเวลาที่รับ)
// ============================================================
static String isoTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 100)) {
    return String("1970-01-01T00:00:00+07:00");
  }
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S+07:00", &timeinfo);
  return String(buf);
}


// ============================================================
//  initMQTT() — ตั้งค่าและเชื่อมต่อ HiveMQ Cloud
// ============================================================
void initMQTT() {
  // ตรวจ certificate ของ HiveMQ ด้วย ISRG Root X1 (ต้อง sync NTP ก่อน — ทำใน initWiFi แล้ว)
  espClient.setCACert(root_ca);

  // ตั้งค่า MQTT server
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);  // เพิ่ม buffer สำหรับ JSON payload ขนาดใหญ่
  // keepalive เริ่มต้น 15 วิ สั้นกว่าคาบ telemetry (30 วิ) — ขยับเป็น 60 วิ ลดโอกาสที่
  // broker ตัดสายเพราะรอ PINGREQ ไม่ทันตอน readSensors/I2C recovery กินเวลา
  mqttClient.setKeepAlive(60);

  // ถ้า WiFi ยังไม่ติดตอนบูต ไม่ต้องลองที่นี่ — mqttLoop() จะต่อให้เองเมื่อมี IP
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[MQTT] Waiting for WiFi before connecting to HiveMQ Cloud");
    return;
  }
  Serial.println("[MQTT] Connecting to HiveMQ Cloud...");
  reconnectMQTT();
}


// ============================================================
//  reconnectMQTT() — เชื่อมต่อใหม่เมื่อหลุด
// ============================================================
static void reconnectMQTT() {
  if (mqttClient.connected()) return;

  Serial.printf("[MQTT] Attempting connection to %s:%d...\n", MQTT_HOST, MQTT_PORT);

  // client id ต้องไม่ซ้ำกับ session อื่นบน broker: MQTT บังคับว่าถ้ามีคนต่อด้วย id เดียวกัน
  // ตัวเก่าจะถูกเตะออก — id คงที่ทำให้ session ค้างของรอบก่อน (หรืออีกตัวที่ใช้ id เดียวกัน)
  // เตะเรากลับไปกลับมา: ต่อได้ publish ได้ครั้งเดียว แล้วหลุดทันที (state=-3)
  String clientId = "ESP32-" + String(NODE_ID) + "-" + String(esp_random(), HEX);

  if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
    Serial.println("[MQTT] Connected!");
    reconnectBackoffMs = RECONNECT_INTERVAL_MS;  // ต่อได้แล้ว — เริ่มนับ backoff ใหม่

    // Subscribe to command and OTA topics
    mqttClient.subscribe(TOPIC_CMD);
    mqttClient.subscribe(TOPIC_OTA_UPDATE);
    Serial.printf("[MQTT] Subscribed to: %s\n", TOPIC_CMD);
    Serial.printf("[MQTT] Subscribed to: %s\n", TOPIC_OTA_UPDATE);
  } else {
    Serial.printf("[MQTT] Failed, rc=%d — next try in %lu s (RSSI %d dBm)\n",
                  mqttClient.state(), reconnectBackoffMs / 1000, WiFi.RSSI());
    // ยิงถี่ ๆ ทุก 5 วิไม่ช่วย: broker ปฏิเสธ TCP/TLS ซ้ำ ๆ อยู่แล้ว และการรัว connect
    // ยังทำให้ถูก throttle ยาวขึ้น — ถอยเป็นเท่าตัวจนสุดที่ RECONNECT_MAX_INTERVAL_MS
    reconnectBackoffMs = min(reconnectBackoffMs * 2, (unsigned long)RECONNECT_MAX_INTERVAL_MS);
  }
}


// ============================================================
//  mqttLoop() — เรียกใน loop() เพื่อ maintain connection
// ============================================================
void mqttLoop() {
  // ไม่มี IP ก็ต่อ MQTT ไม่ได้: retry WiFi ก่อน แล้วออกไปเลย ไม่ต้องเสียเวลา
  // handshake TLS ที่ล้มเหลวแน่นอน (rc=-2 รัว ๆ ทุก 5 วิ)
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now = millis();
    if (now - lastWiFiAttempt > WIFI_RETRY_INTERVAL_MS) {
      lastWiFiAttempt = now;
      Serial.printf("[WiFi] Retrying %s...\n", WIFI_SSID);
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
    return;
  }

  // WiFi กลับมาแล้วแต่ยังไม่เคย sync เวลา (บูตมาตอน AP ยังไม่ขึ้น) — sync ตอนนี้
  // ก่อนจะ publish อะไร ไม่งั้น timestamp เป็นปี 1970
  if (!ntpSynced) {
    Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    syncNTP();
  }

  if (!mqttClient.connected()) {
    // รายงานตอนหลุดครั้งแรก พร้อม state + RSSI — ไม่งั้นเห็นแค่ rc=-2 ซ้ำ ๆ โดยไม่รู้ว่าหลุดตอนไหน
    if (wasConnected) {
      wasConnected = false;
      Serial.printf("[MQTT] Connection lost (state=%d, RSSI %d dBm)\n",
                    mqttClient.state(), WiFi.RSSI());
    }
    unsigned long now = millis();
    if (now - lastReconnectAttempt > reconnectBackoffMs) {
      lastReconnectAttempt = now;
      reconnectMQTT();
    }
  } else {
    wasConnected = true;
  }
  mqttClient.loop();
}


// ============================================================
//  isMQTTConnected()
// ============================================================
bool isMQTTConnected() {
  return mqttClient.connected();
}


// ============================================================
//  publishTelemetry() — ส่งข้อมูลเซนเซอร์ทุก 30 วินาที
// ============================================================
void publishTelemetry(const SensorData& data, const char* aqiClass, bool anomalyDetected) {
  if (!mqttClient.connected()) return;

  JsonDocument doc;

  doc["schema_version"] = "1.2";
  doc["org"] = ORG_ID;
  doc["node_id"] = NODE_ID;

  // Timestamp (ISO 8601) จาก NTP — sync ใน initWiFi()
  doc["timestamp"] = isoTimestamp();

  // Location
  JsonObject loc = doc["location"].to<JsonObject>();
  loc["lat"] = 12.2431;  // ตำแหน่งจังหวัดตราด
  loc["lon"] = 102.5150;
  loc["alt"] = 5.0;
  loc["zone"] = NODE_ZONE;

  // Sensors
  JsonObject sensors = doc["sensors"].to<JsonObject>();

  JsonObject pm25 = sensors["pm2_5"].to<JsonObject>();
  pm25["value"] = data.pm2_5;
  pm25["unit"] = "ug/m3";
  pm25["status"] = getSensorStatus("pm2_5", data.pm2_5);

  JsonObject pm10 = sensors["pm10"].to<JsonObject>();
  pm10["value"] = data.pm10;
  pm10["unit"] = "ug/m3";
  pm10["status"] = getSensorStatus("pm10", data.pm10);

  JsonObject co2 = sensors["co2"].to<JsonObject>();
  co2["value"] = data.co2;
  co2["unit"] = "ppm";
  co2["status"] = getSensorStatus("co2", data.co2);

  JsonObject tvoc = sensors["tvoc"].to<JsonObject>();
  tvoc["value"] = data.tvoc;
  tvoc["unit"] = "ppb";
  tvoc["status"] = getSensorStatus("tvoc", data.tvoc);

  JsonObject temp = sensors["temp"].to<JsonObject>();
  temp["value"] = data.temperature;
  temp["unit"] = "C";
  temp["status"] = getSensorStatus("temp", data.temperature);

  JsonObject hum = sensors["hum"].to<JsonObject>();
  hum["value"] = data.humidity;
  hum["unit"] = "%RH";
  hum["status"] = getSensorStatus("hum", data.humidity);

  // Edge Inference
  JsonObject edge = doc["edge_inference"].to<JsonObject>();
  edge["aqi_class"] = aqiClass;
  edge["anomaly_detected"] = anomalyDetected;
  edge["model_version"] = "1.0.0-mock";

  // Device Health
  JsonObject health = doc["device_health"].to<JsonObject>();
  health["battery_pct"] = 100;  // ESP32-S3 ใช้ USB power
  health["rssi"] = WiFi.RSSI();
  health["uptime_sec"] = (int)(millis() / 1000);
  health["fw_version"] = FW_VERSION;

  // Serialize and publish
  char buffer[1024];
  serializeJson(doc, buffer, sizeof(buffer));

  bool ok = mqttClient.publish(TOPIC_TELEMETRY, buffer);
  if (ok) {
    Serial.println("[MQTT] Telemetry published");
  } else {
    Serial.println("[MQTT] Telemetry publish FAILED");
  }
}


// ============================================================
//  publishAlert() — ส่ง Alert ทันทีเมื่อค่าเกิน threshold
// ============================================================
void publishAlert(const char* sensor, float value, float threshold,
                  const char* standard, const char* severity, bool isAnomaly) {
  if (!mqttClient.connected()) return;

  JsonDocument doc;
  doc["org"] = ORG_ID;
  doc["node_id"] = NODE_ID;
  doc["sensor"] = sensor;
  doc["value"] = value;
  doc["threshold"] = threshold;
  doc["standard"] = standard;
  doc["severity"] = severity;
  doc["is_anomaly"] = isAnomaly;
  doc["timestamp"] = isoTimestamp();

  char buffer[512];
  serializeJson(doc, buffer, sizeof(buffer));

  bool ok = mqttClient.publish(TOPIC_ALERT, buffer);
  Serial.printf("[MQTT] Alert %s: %s\n", ok ? "sent" : "FAILED", sensor);
}


// ============================================================
//  publishHealth() — ส่ง Device Health ทุก 5 นาที
// ============================================================
void publishHealth() {
  if (!mqttClient.connected()) return;

  JsonDocument doc;
  doc["org"] = ORG_ID;
  doc["node_id"] = NODE_ID;
  doc["battery_pct"] = 100;
  doc["rssi"] = WiFi.RSSI();
  doc["uptime_sec"] = (int)(millis() / 1000);
  doc["fw_version"] = FW_VERSION;

  char buffer[256];
  serializeJson(doc, buffer, sizeof(buffer));

  bool ok = mqttClient.publish(TOPIC_HEALTH, buffer);
  Serial.printf("[MQTT] Health %s\n", ok ? "sent" : "FAILED");
}
