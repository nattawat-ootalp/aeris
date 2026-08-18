// reused from AirSentinel
#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>
#include <Wire.h>
#include <SensirionI2cScd4x.h>
#include <SparkFun_SGP30_Arduino_Library.h>
#include <PMS.h>

// ===== GPIO Pins =====
// รวม I2C ไว้ที่ Bus 0 (ขา 15, 16)
#define I2C_SDA 15
#define I2C_SCL 16

// PMS7003 — UART (Hardware Serial)
#define PMS_RX_PIN 5
#define PMS_TX_PIN 4
#define PMS_BAUD   9600

// ===== I2C addresses ของเซนเซอร์ที่ "ต้องมี" =====
// มีไว้เทียบกับผลสแกนบัส เพื่อบอกให้ชัดว่าตัวไหนหาย ไม่ใช่แค่พิมพ์ว่าใครตอบ
#define ADDR_SCD40 0x62
#define ADDR_SGP30 0x58

// รอบการค้นหาเซนเซอร์ที่ยังไม่มีข้อมูล — ถี่กว่าเดิม (เดิมกู้บัสทุก 30 วิ) ได้
// เพราะการ probe หนึ่ง address ไม่รบกวนตัวที่ทำงานอยู่ ต่างจากการล้างบัส
#define DISCOVERY_INTERVAL_MS 10000UL

// ===== Struct เก็บค่าเซนเซอร์ =====
struct SensorData {
  float pm2_5, pm10;
  bool  pms_valid;
  float co2, temperature, humidity;
  bool  scd40_valid;
  float tvoc, eco2;
  bool  sgp30_valid;
  bool  all_valid;
};

// ===== Function Declarations =====
void        initSensors();
SensorData  readSensors();
void        printSensorData(const SensorData& data);
bool        isSensorReady();
String      getSensorStatus(const char* sensor, float value);

#endif // SENSORS_H