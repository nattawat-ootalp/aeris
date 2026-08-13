// reused from AirSentinel
// ══════════════════════════════════════════════════════════════
//  AirSentinel — Node Configuration Template
//
//  วิธีใช้: คัดลอกไฟล์นี้เป็น  config.h  แล้วแก้ค่าให้ตรงกับ
//  สภาพแวดล้อมของคุณ (config.h ถูก gitignore ไว้ — รหัสผ่านจะไม่
//  ติดขึ้น repository)
// ══════════════════════════════════════════════════════════════
#ifndef CONFIG_H
#define CONFIG_H

// ===== WiFi (รองรับเฉพาะย่าน 2.4GHz) =====
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// ===== HiveMQ Cloud (MQTT over TLS) =====
// ที่อยู่ cluster ดูได้จากหน้า Overview ใน console.hivemq.cloud
#define MQTT_HOST     "xxxxxxxxxxxxxxxx.s1.eu.hivemq.cloud"
#define MQTT_PORT     8883
// บัญชี MQTT สร้างที่เมนู Access Management ของ cluster
#define MQTT_USER     "YOUR_MQTT_USERNAME"
#define MQTT_PASS     "YOUR_MQTT_PASSWORD"

// ===== Organization & Node =====
#define ORG_ID        "airsentinel-trat"   // รหัสองค์กร (slug)
#define NODE_ID       "BKK-TRT-001"        // รหัสโหนด — ต้องตรงกับ node_code ในระบบ
#define NODE_ZONE     "Zone A"             // โซนพื้นที่ติดตั้ง

#endif // CONFIG_H
