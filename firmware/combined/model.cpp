// reused from AirSentinel
#include "model.h"

// ===== Alert state tracking =====
// เก็บสถานะ "ค่าเกิน threshold" ของรอบก่อนหน้า
// Alert จะถูกส่งเมื่อค่าเกิน threshold ติดต่อกัน 2 รอบ (60 วินาที)
static bool prev_pm25_exceeded  = false;
static bool prev_pm10_exceeded  = false;
static bool prev_co2_exceeded   = false;
static bool prev_tvoc_exceeded  = false;

// ===== Anomaly detection — simple z-score tracking =====
// เก็บค่าเฉลี่ยและส่วนเบี่ยงเบนมาตรฐานแบบ running
static float pm25_avg = 15.0f;
static float pm25_var = 25.0f;  // variance
static int   sample_count = 0;
#define ANOMALY_Z_THRESHOLD 3.0f  // ค่า z-score ที่ถือว่าผิดปกติ


// ============================================================
//  initModel()
//  Phase 1: Rule-based — ไม่ต้องโหลดโมเดล
//  Phase 2: จะโหลด model.tflite ด้วย TFLite Micro
// ============================================================
void initModel() {
  Serial.println("[Model] Initialized (Phase 1: Rule-based classification)");
  Serial.println("[Model] AQI thresholds: WHO 2021 + PCD Thailand");
  Serial.println("[Model] Anomaly detection: Z-score method");
}


// ============================================================
//  classifyAQI()
//  จำแนกระดับ AQI จากค่า PM2.5
//  ใช้ Dual Standard: WHO 2021 (Strict) + PCD Thailand
// ============================================================
static const char* classifyAQI(float pm25) {
  if (pm25 <= 15.0f)  return "Good";           // WHO 2021: 0-15
  if (pm25 <= 25.0f)  return "Moderate";        // WHO 2021: 15.1-25
  if (pm25 <= 37.5f)  return "Unhealthy";       // PCD Thailand: 25.1-37.5
  if (pm25 <= 75.0f)  return "Very Unhealthy";  // PCD/WHO: 37.6-75
  return "Hazardous";                            // PCD/WHO: >75
}


// ============================================================
//  detectAnomaly()
//  ตรวจจับค่าผิดปกติด้วย Z-score
//  อัปเดต running mean/variance แบบ Welford's algorithm
// ============================================================
static bool detectAnomaly(float pm25) {
  sample_count++;

  if (sample_count < 10) {
    // สะสมข้อมูลอย่างน้อย 10 รอบก่อนเริ่มตรวจจับ
    float delta = pm25 - pm25_avg;
    pm25_avg += delta / sample_count;
    float delta2 = pm25 - pm25_avg;
    pm25_var += (delta * delta2 - pm25_var) / sample_count;
    return false;
  }

  // คำนวณ z-score
  float stddev = sqrtf(pm25_var);
  if (stddev < 1.0f) stddev = 1.0f;  // ป้องกัน division by zero

  float z_score = fabsf(pm25 - pm25_avg) / stddev;

  // อัปเดต running stats (exponential moving)
  float alpha = 0.05f;  // อัตราการเรียนรู้
  pm25_avg = pm25_avg * (1.0f - alpha) + pm25 * alpha;
  float diff = pm25 - pm25_avg;
  pm25_var = pm25_var * (1.0f - alpha) + diff * diff * alpha;

  if (z_score > ANOMALY_Z_THRESHOLD) {
    Serial.printf("[Model] ANOMALY detected! PM2.5=%.1f, z=%.2f\n", pm25, z_score);
    return true;
  }

  return false;
}


// ============================================================
//  runInference()
//  รับข้อมูลเซนเซอร์ → คืน ModelResult
// ============================================================
ModelResult runInference(const SensorData& data) {
  ModelResult result;

  // ค่าเริ่มต้น anomaly — ยังไม่พบ
  result.anomaly_sensor = "";
  result.anomaly_value  = 0.0f;

  // จำแนก AQI class จาก PM2.5
  if (data.pms_valid) {
    result.aqi_class = classifyAQI(data.pm2_5);
    result.anomaly_detected = detectAnomaly(data.pm2_5);
    if (result.anomaly_detected) {
      result.anomaly_sensor = "pm2_5";
      result.anomaly_value  = data.pm2_5;
    }
  } else {
    result.aqi_class = "Unknown";
    result.anomaly_detected = false;
  }

  // คำนวณ confidence (ยิ่งเซนเซอร์อ่านได้ครบ ยิ่ง confidence สูง)
  int valid_count = 0;
  if (data.pms_valid)   valid_count++;
  if (data.scd40_valid) valid_count++;
  if (data.sgp30_valid) valid_count++;
  result.confidence = (float)valid_count / 3.0f;

  // ตรวจจับ anomaly เพิ่มเติมจาก CO2 และ TVOC — ระบุเซนเซอร์ที่ผิดปกติด้วย
  if (data.scd40_valid && data.co2 > 2000.0f) {
    result.anomaly_detected = true;
    result.anomaly_sensor = "co2";
    result.anomaly_value  = data.co2;
    Serial.printf("[Model] CO2 anomaly: %.0f ppm\n", data.co2);
  }
  if (data.sgp30_valid && data.tvoc > 660.0f) {
    result.anomaly_detected = true;
    result.anomaly_sensor = "tvoc";
    result.anomaly_value  = data.tvoc;
    Serial.printf("[Model] TVOC anomaly: %.0f ppb\n", data.tvoc);
  }

  Serial.printf("[Model] AQI=%s, Anomaly=%s, Confidence=%.0f%%\n",
    result.aqi_class,
    result.anomaly_detected ? "YES" : "no",
    result.confidence * 100.0f);

  return result;
}


// ============================================================
//  checkAlertConditions()
//  ตรวจสอบเงื่อนไข alert ตาม Design Document:
//  - ค่าเกิน threshold ต่อเนื่อง 2 รอบ (60 วิ) → ส่ง alert
//  - Anomaly → ส่งทันที ไม่รอ 2 รอบ
// ============================================================
bool checkAlertConditions(const SensorData& data) {
  bool shouldAlert = false;

  // PM2.5 > 37.5 (PCD Thailand threshold สำหรับ "Unhealthy")
  if (data.pms_valid) {
    bool pm25_exceeded = (data.pm2_5 > 37.5f);
    if (pm25_exceeded && prev_pm25_exceeded) {
      shouldAlert = true;
      Serial.printf("[Alert] PM2.5 exceeded 2 consecutive: %.1f\n", data.pm2_5);
    }
    prev_pm25_exceeded = pm25_exceeded;

    // PM10 > 80 (PCD Thailand)
    bool pm10_exceeded = (data.pm10 > 80.0f);
    if (pm10_exceeded && prev_pm10_exceeded) {
      shouldAlert = true;
      Serial.printf("[Alert] PM10 exceeded 2 consecutive: %.1f\n", data.pm10);
    }
    prev_pm10_exceeded = pm10_exceeded;
  }

  // CO2 > 2000 (ASHRAE 62.1)
  if (data.scd40_valid) {
    bool co2_exceeded = (data.co2 > 2000.0f);
    if (co2_exceeded && prev_co2_exceeded) {
      shouldAlert = true;
      Serial.printf("[Alert] CO2 exceeded 2 consecutive: %.0f\n", data.co2);
    }
    prev_co2_exceeded = co2_exceeded;
  }

  // TVOC > 660 (UBA Germany)
  if (data.sgp30_valid) {
    bool tvoc_exceeded = (data.tvoc > 660.0f);
    if (tvoc_exceeded && prev_tvoc_exceeded) {
      shouldAlert = true;
      Serial.printf("[Alert] TVOC exceeded 2 consecutive: %.0f\n", data.tvoc);
    }
    prev_tvoc_exceeded = tvoc_exceeded;
  }

  return shouldAlert;
}
