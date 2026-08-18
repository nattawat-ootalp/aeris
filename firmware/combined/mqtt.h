// reused from AirSentinel
#ifndef MQTT_H
#define MQTT_H

#include <Arduino.h>
#include "sensors.h"

// ===== Node Configuration =====
// ค่า WiFi / MQTT / org / node อยู่ใน config.h (สร้างจาก config.example.h)
#include "config.h"

#ifndef WIFI_SSID
#error "ไม่พบค่าคอนฟิก — คัดลอก config.example.h เป็น config.h แล้วกำหนดค่าก่อน compile"
#endif

// ===== Firmware Version =====
// Defined HERE, not in the sketch. A #define in combined.ino reaches only that translation
// unit, so mqtt.cpp kept compiling against the old default and published a version the board
// was not running — which is exactly the kind of thing a version string exists to prevent.
#define FW_VERSION    "combined-1.0.0"

// ===== MQTT Topic Patterns =====
// {org}/airsentinel/{node_id}/{sub-topic}
#define TOPIC_TELEMETRY  ORG_ID "/airsentinel/" NODE_ID "/telemetry"
#define TOPIC_ALERT      ORG_ID "/airsentinel/" NODE_ID "/alert"
#define TOPIC_HEALTH     ORG_ID "/airsentinel/" NODE_ID "/health"
#define TOPIC_CMD        ORG_ID "/airsentinel/" NODE_ID "/cmd"
#define TOPIC_OTA_UPDATE ORG_ID "/airsentinel/" NODE_ID "/ota/update"
#define TOPIC_OTA_ACK    ORG_ID "/airsentinel/" NODE_ID "/ota/ack"

// ===== Function Declarations =====
void initWiFi();
void initMQTT();
void mqttLoop();
bool isMQTTConnected();

// ส่งข้อมูล Telemetry (ทุก 30 วินาที)
// Buffers the sample instead of dropping it when the broker is unreachable or the publish
// fails, so call it every telemetry cycle regardless of connection state.
void publishTelemetry(const SensorData& data, const char* aqiClass, bool anomalyDetected);

// Publish buffered telemetry to a reconnected broker, a few per call. Call every loop; it is a
// no-op while disconnected or once the buffer is empty. Replayed frames carry the timestamp
// they were measured at, which is the only thing distinguishing them from a live one.
void mqttServiceBuffer();

// ส่ง Alert ทันทีเมื่อค่าเกิน threshold
void publishAlert(const char* sensor, float value, float threshold,
                  const char* standard, const char* severity, bool isAnomaly);

// ส่ง Device Health (ทุก 5 นาที)
void publishHealth();

#endif // MQTT_H
