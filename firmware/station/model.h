// reused from AirSentinel
#ifndef MODEL_H
#define MODEL_H

#include <Arduino.h>
#include "sensors.h"

// ===== AQI Classification Result =====
struct ModelResult {
  const char* aqi_class;      // "Good", "Moderate", "Unhealthy", "Very Unhealthy", "Hazardous"
  bool        anomaly_detected;
  const char* anomaly_sensor;  // เซนเซอร์ที่ผิดปกติ: "pm2_5" / "co2" / "tvoc" ("" = ไม่มี)
  float       anomaly_value;   // ค่าจริงของเซนเซอร์นั้นตอนผิดปกติ
  float       confidence;      // 0.0 - 1.0
};

// ===== Function Declarations =====

/**
 * initModel()
 * เริ่มต้นโมเดล TinyML (Phase 1: ใช้ Rule-based classification)
 * ในอนาคตจะโหลด TFLite Micro model จาก model.tflite
 */
void initModel();

/**
 * runInference()
 * รับข้อมูลเซนเซอร์ → จำแนกระดับ AQI และตรวจจับ anomaly
 * Phase 1: ใช้ threshold-based rules ตามมาตรฐาน WHO 2021 / PCD Thailand
 * Phase 2: จะเปลี่ยนเป็น TFLite Micro inference จริง
 */
ModelResult runInference(const SensorData& data);

/**
 * checkAlertConditions()
 * ตรวจสอบว่าค่าเซนเซอร์ใดเกิน threshold หรือไม่
 * คืนค่า true ถ้าต้องส่ง alert
 * ใช้กลไก "2 รอบติดต่อกัน" (60 วินาที) เพื่อกรอง noise
 */
bool checkAlertConditions(const SensorData& data);

#endif // MODEL_H
