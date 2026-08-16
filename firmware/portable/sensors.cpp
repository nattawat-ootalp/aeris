// reused from AirSentinel
#include "sensors.h"

// ===== Object declarations =====
static SensirionI2cScd4x scd40;
static SGP30             sgp30;
static HardwareSerial    pmsSerial(2);   
static PMS               pms(pmsSerial);
static PMS::DATA         pmsData;

// ===== I2C Bus (รวมไว้ที่ Bus 0 ทั้งหมด) =====
static TwoWire I2C_0 = TwoWire(0);      

static bool scd40_initialized  = false;
static bool sgp30_initialized  = false;
static bool pms_initialized    = false;

#define SGP30_WARMUP_MS 15000
static unsigned long sgp30_start_ms = 0;

// ตัวแปรสำหรับจำค่าล่าสุด
static SensorData currentData = {};
static unsigned long last_pms_read   = 0;
static unsigned long last_scd40_read = 0;      // อ่านค่าได้จริงครั้งล่าสุด
static unsigned long last_scd40_recover = 0;   // สั่งกู้บัสครั้งล่าสุด (คนละอย่างกับข้างบน)
static unsigned long last_sgp30_read = 0;

#define I2C_SDA_PIN 15
#define I2C_SCL_PIN 16
// 50kHz แทน 100kHz — ช้าลงแต่ทนสัญญาณรบกวน/สายยาวกว่ามาก
// (ปริมาณข้อมูลเซนเซอร์น้อยมาก ความเร็วไม่มีผลต่อการทำงาน)
#define I2C_FREQ_HZ 50000UL

// DO NOT MODIFY — AirSentinel I2C bus fix
// [เพิ่ม] I2C bus-clear ตามสเปก: ถ้า slave ค้างกลางบิตแล้วกด SDA ไว้ต่ำ
// การ end()/begin() ของ ESP32 ช่วยไม่ได้ — ต้อง clock SCL ด้วยมือจน slave
// ปล่อยขา แล้วปิดท้ายด้วย STOP condition
static void i2cBusClear() {
  pinMode(I2C_SDA_PIN, INPUT_PULLUP);
  pinMode(I2C_SCL_PIN, OUTPUT);
  for (int i = 0; i < 16 && digitalRead(I2C_SDA_PIN) == LOW; i++) {
    digitalWrite(I2C_SCL_PIN, LOW);
    delayMicroseconds(10);
    digitalWrite(I2C_SCL_PIN, HIGH);
    delayMicroseconds(10);
  }
  // STOP condition: SDA ต่ำ -> สูง ขณะ SCL สูง
  pinMode(I2C_SDA_PIN, OUTPUT);
  digitalWrite(I2C_SDA_PIN, LOW);
  delayMicroseconds(10);
  digitalWrite(I2C_SCL_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(I2C_SDA_PIN, HIGH);
  delayMicroseconds(10);
  pinMode(I2C_SDA_PIN, INPUT_PULLUP);
  pinMode(I2C_SCL_PIN, INPUT_PULLUP);
}

// [เพิ่ม] ฟังก์ชันสำหรับรีเซ็ต I2C Bus เมื่อค้าง
// กู้เฉพาะตัวที่เสียจริง — SGP30 ที่ยังอ่านได้ปกติจะไม่ถูกรีเซ็ต
// (การรีเซ็ต SGP30 ทุกครั้งทำให้ TVOC วนกลับไป warmup 15 วิ ไม่นิ่งสักที)
void recoverI2CBus() {
  static uint32_t recoverCount = 0;
  recoverCount++;
  Serial.printf("[System] Bus Hang detected! Recovering I2C... (ครั้งที่ %lu)\n", recoverCount);

  I2C_0.end();
  delay(50);
  i2cBusClear();
  I2C_0.begin(I2C_SDA_PIN, I2C_SCL_PIN, I2C_FREQ_HZ);
  delay(50);

  // SCD40 (ตัวที่ trigger การกู้): begin() เฉย ๆ ไม่ทำให้กลับมาวัด —
  // ต้อง restart periodic measurement
  scd40.begin(I2C_0, SCD40_I2C_ADDR_62);
  scd40.stopPeriodicMeasurement();   // สั่งได้ทุก state ตาม datasheet
  delay(500);
  if (scd40.startPeriodicMeasurement() == 0) {
    Serial.println("[SCD40] recovered — periodic measurement restarted");
  } else {
    // ไม่ปิด flag เพื่อให้วน retry ทุก 30 วิต่อ — ถ้ายังเงียบแสดงว่า
    // เซนเซอร์แครชระดับต้องตัดไฟ (brown-out) ซอฟต์แวร์ช่วยไม่ได้
    Serial.println("[SCD40] still silent after bus-clear (suspect power brown-out)");
  }

  // SGP30: รีเซ็ตเฉพาะเมื่อมันเงียบเกิน 30 วิจริง ๆ (ค้างทั้งบัส)
  // ถ้ายังอ่านได้อยู่ ปล่อยให้ทำงานต่อ — ไม่ต้องเสีย warmup 15 วิใหม่
  if (millis() - last_sgp30_read > 30000UL) {
    if (sgp30.begin(I2C_0) == true) {
      sgp30.initAirQuality();
      sgp30_start_ms = millis();
      Serial.println("[SGP30] re-initialized — warming up");
    } else {
      Serial.println("[SGP30] not found after recover");
    }
  } else {
    Serial.println("[SGP30] still healthy — skip re-init");
  }
}

void initSensors() {
  Serial.println("[Sensors] Initializing...");
  I2C_0.begin(I2C_SDA_PIN, I2C_SCL_PIN, I2C_FREQ_HZ);

  // ==================== SCD40 ====================
  scd40.begin(I2C_0, SCD40_I2C_ADDR_62);
  scd40.stopPeriodicMeasurement();
  delay(500);
  if (scd40.startPeriodicMeasurement() == 0) {
    scd40_initialized = true;
    Serial.println("[SCD40] OK (Bus 0)");
  } else {
    scd40_initialized = false;
    Serial.println("[SCD40] ERROR");
  }

  // ==================== SGP30 ====================
  if (sgp30.begin(I2C_0) == false) {
    Serial.println("[SGP30] ERROR: Sensor not found on Bus 0!");
    sgp30_initialized = false;
  } else {
    Serial.println("[SGP30] OK (Bus 0) — warming up...");
    sgp30_initialized = true;
    sgp30_start_ms = millis();
    sgp30.initAirQuality();
  }

  // ==================== PMS7003 ====================
  pmsSerial.begin(PMS_BAUD, SERIAL_8N1, PMS_RX_PIN, PMS_TX_PIN);
  delay(100);
  pms.activeMode();
  pms_initialized = true;
  Serial.println("[PMS7003] OK — active mode");
  
  Serial.println("[Sensors] Init complete");
}

bool isSensorReady() {
  if (!sgp30_initialized) return false;
  return (millis() - sgp30_start_ms) >= SGP30_WARMUP_MS;
}

SensorData readSensors() {
  unsigned long now = millis();

  // ตรวจสอบสถานะการค้าง (ถ้า SCD40 เงียบเกิน 30 วินาที ให้สั่ง Reset Bus)
  //
  // last_scd40_read = "อ่านค่าได้จริงครั้งล่าสุด" เท่านั้น ห้ามเลื่อนตอน recover:
  // การ recover ไม่ได้ทำให้มีค่าใหม่ ถ้าเลื่อนจะทำให้ scd40_valid (บรรทัดล่าง) กลับเป็น true
  // ทันทีทั้งที่ currentData ยังเป็นค่าค้างจากก่อนบัสแฮงก์ แล้วค่าเก่านั้นจะถูกส่งออก BLE
  // เป็นค่าปัจจุบัน — อาการคือ "รีสตาร์ทแล้วยังขึ้นค่าเดิม" และผิดกฎ §5.6/§14 ที่ห้าม
  // ใช้ค่าเก่าแทนค่าปัจจุบัน ต้องเป็น No Data จนกว่าจะอ่านได้จริง
  // ใช้ตัวแปรแยกคุมจังหวะ recover แทน เพื่อไม่ให้กู้รัวทุกลูปเมื่อเซนเซอร์เงียบยาว
  if (scd40_initialized && (now - last_scd40_read > 30000)
      && (last_scd40_recover == 0 || now - last_scd40_recover > 30000)) {
     recoverI2CBus();
     last_scd40_recover = now;
     // ทิ้งค่าค้างทันที: หลังกู้บัสยังไม่มีการวัดใหม่ ค่าก่อนแฮงก์ไม่ใช่สภาพปัจจุบันอีกต่อไป
     currentData.co2 = NAN;
     currentData.temperature = NAN;
     currentData.humidity = NAN;
  }

  // ==================== 1. อ่าน SCD40 ====================
  if (scd40_initialized) {
    bool isReady = false;
    if (scd40.getDataReadyStatus(isReady) == 0 && isReady) {
      uint16_t co2; float t, h;
      if (scd40.readMeasurement(co2, t, h) == 0 && co2 > 0) {
        currentData.co2 = (float)co2; 
        currentData.temperature = t; 
        currentData.humidity = h;
        last_scd40_read = now; 
      }
    }
  }
  currentData.scd40_valid = (now - last_scd40_read < 10000);

  // ==================== 2. อ่าน SGP30 ====================
  if (sgp30_initialized && isSensorReady()) {
    if (sgp30.measureAirQuality() == SGP30_SUCCESS) {
      currentData.tvoc = (float)sgp30.TVOC; 
      currentData.eco2 = (float)sgp30.CO2;
      last_sgp30_read = now;
      
      if (currentData.scd40_valid) {
        float T = currentData.temperature; float RH = currentData.humidity;
        float AH = 216.7f * (RH / 100.0f * 6.112f * exp(17.67f * T / (T + 243.5f))) / (T + 273.15f);
        sgp30.setHumidity((uint16_t)(AH * 256.0f));
      }
    }
  }
  currentData.sgp30_valid = (now - last_sgp30_read < 5000) && isSensorReady();

  // ==================== 3. อ่าน PMS7003 ====================
  if (pms_initialized) {
    while (pmsSerial.available()) {
      if (pms.read(pmsData)) {
        // กรองค่าขยะ Noise
        if (pmsData.PM_AE_UG_2_5 < 500) {
            currentData.pm2_5 = (float)pmsData.PM_AE_UG_2_5;
            currentData.pm10  = (float)pmsData.PM_AE_UG_10_0;
            last_pms_read = now;
        }
      }
    }
  }
  currentData.pms_valid = (now - last_pms_read < 5000);

  currentData.all_valid = (currentData.scd40_valid && currentData.pms_valid && currentData.sgp30_valid); 
  return currentData;
}

String getSensorStatus(const char* sensor, float value) {
  String s = String(sensor);
  if (s == "pm2_5") { if (value <= 15.0f) return "ok"; if (value <= 37.5f) return "warn"; return "error"; }
  if (s == "pm10")  { if (value <= 50.0f) return "ok"; if (value <= 80.0f) return "warn"; return "error"; }
  if (s == "co2")   { if (value < 1000.0f) return "ok"; if (value < 2000.0f) return "warn"; return "error"; }
  if (s == "tvoc")  { if (value <= 220.0f) return "ok"; if (value <= 660.0f) return "warn"; return "error"; }
  return "ok";
}

void printSensorData(const SensorData& data) {
  Serial.println("===== Sensor Readings =====");
  
  if (data.pms_valid) {
    Serial.printf("  PM2.5: %.1f | PM10: %.1f\n", data.pm2_5, data.pm10);
  } else {
    Serial.println("  PMS7003: NO DATA/Waiting");
  }
  
  if (data.scd40_valid) {
    Serial.printf("  CO2: %.0f | Temp: %.1f | Hum: %.1f\n", data.co2, data.temperature, data.humidity);
  } else {
    Serial.println("  SCD40: NO DATA/Waiting");
  }
  
  if (data.sgp30_valid) {
    Serial.printf("  TVOC: %.0f | eCO2: %.0f\n", data.tvoc, data.eco2);
  } else {
    Serial.println("  SGP30: NO DATA/Waiting");
  }
  
  Serial.println("===========================");
}
