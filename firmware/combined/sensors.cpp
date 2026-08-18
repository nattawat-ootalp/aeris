// reused from AirSentinel
#include "sensors.h"
#include <driver/gpio.h>

// ===== Object declarations =====
static SensirionI2cScd4x scd40;
static SGP30             sgp30;
static HardwareSerial    pmsSerial(2);   
static PMS               pms(pmsSerial);
static PMS::DATA         pmsData;

// ===== I2C Bus =====
// ปกติเซนเซอร์ทั้งสองตัวอยู่บัสเดียวกัน (Bus 0 ขา 15/16) แต่ถ้าการสแกนขาเจอว่ามันถูกต่อ
// คนละคู่ขา ตัวที่สองจะได้ Bus 1 ไปใช้ ESP32-S3 มี I2C peripheral 2 ตัวพอดี
static TwoWire I2C_0 = TwoWire(0);
static TwoWire I2C_1 = TwoWire(1);

// ขาจริงที่แต่ละตัวถูกต่ออยู่ เริ่มจากค่า default แล้วให้การสแกนแก้ทีหลังถ้าไม่ตรง
static int scd_sda = I2C_SDA, scd_scl = I2C_SCL;
static int sgp_sda = I2C_SDA, sgp_scl = I2C_SCL;
static TwoWire* scdWire = &I2C_0;
static TwoWire* sgpWire = &I2C_0;

static bool scd40_initialized  = false;
static bool sgp30_initialized  = false;
static bool pms_initialized    = false;

#define SGP30_WARMUP_MS 15000
static unsigned long sgp30_start_ms = 0;

// ตัวแปรสำหรับจำค่าล่าสุด
// เริ่มด้วย NAN ไม่ใช่ 0: ถ้ามีเส้นทางไหนหลุดการเช็ค *_valid ไป ค่าที่ออกไปต้องอ่านออกว่า
// "ไม่มีข้อมูล" ไม่ใช่ศูนย์ที่ดูเหมือนอากาศสะอาดหรือห้องเย็น
static SensorData currentData = {
  NAN, NAN, false,      // pm2_5, pm10, pms_valid
  NAN, NAN, NAN, false, // co2, temperature, humidity, scd40_valid
  NAN, NAN, false,      // tvoc, eco2, sgp30_valid
  false                 // all_valid
};
static unsigned long last_scd40_read = 0;      // อ่านค่าได้จริงครั้งล่าสุด
static unsigned long last_scd40_recover = 0;   // สั่งกู้บัสครั้งล่าสุด (คนละอย่างกับข้างบน)
static unsigned long last_sgp30_read = 0;
static unsigned long last_sgp30_retry = 0;   // จังหวะลองปลุก SGP30 กลับมา
static unsigned long last_pms_read   = 0;
static unsigned long last_pms_retry  = 0;    // จังหวะสั่ง activeMode ซ้ำให้ PMS
static unsigned long last_discovery  = 0;    // รอบค้นหาเซนเซอร์ที่หายไป
static unsigned long last_pin_sweep  = 0;    // รอบกวาดหาขา (แพงกว่ามาก จึงห่างกว่า)

#define I2C_SDA_PIN I2C_SDA
#define I2C_SCL_PIN I2C_SCL
// 50kHz แทน 100kHz — ช้าลงแต่ทนสัญญาณรบกวน/สายยาวกว่ามาก
// (ปริมาณข้อมูลเซนเซอร์น้อยมาก ความเร็วไม่มีผลต่อการทำงาน)
#define I2C_FREQ_HZ 50000UL

// เปิดบัสพร้อมบังคับ pull-up ภายในของ ESP32 บนทั้งสองขา
//
// โมดูลเซนเซอร์บางตัวไม่มีตัวต้านทาน pull-up มาให้ (หรือไหม้ไปตอนไฟช็อต) แล้ว I2C จะไม่ทำงาน
// เลยเพราะไม่มีอะไรดึงสายกลับขึ้น HIGH — อาการคือไม่มีใคร ACK ทั้งที่เซนเซอร์ยังดี
// pull-up ในชิปอ่อนกว่ามาก (~45k เทียบกับ 4.7k) แต่ที่ 50 kHz และสายสั้นก็เพียงพอ
// ใช้ gpio_set_pull_mode ไม่ใช่ pinMode: อันหลังจะไปยุ่งกับการ route ขาเข้า I2C peripheral
static void i2cBeginWithPullups(TwoWire* bus, int sda, int scl) {
  bus->begin(sda, scl, I2C_FREQ_HZ);
  gpio_set_pull_mode((gpio_num_t)sda, GPIO_PULLUP_ONLY);
  gpio_set_pull_mode((gpio_num_t)scl, GPIO_PULLUP_ONLY);
}

// DO NOT MODIFY — AirSentinel I2C bus fix
// [เพิ่ม] I2C bus-clear ตามสเปก: ถ้า slave ค้างกลางบิตแล้วกด SDA ไว้ต่ำ
// การ end()/begin() ของ ESP32 ช่วยไม่ได้ — ต้อง clock SCL ด้วยมือจน slave
// ปล่อยขา แล้วปิดท้ายด้วย STOP condition
// (ลำดับสัญญาณเหมือนเดิมทุกบรรทัด เปลี่ยนแค่รับขาเป็นพารามิเตอร์ เพราะตอนนี้ขา I2C
//  ไม่ได้ถูกฟิกซ์ที่ 15/16 อีกแล้ว — การสแกนอาจพบว่าเซนเซอร์อยู่คู่ขาอื่น)
static void i2cBusClear(int sdaPin, int sclPin) {
  pinMode(sdaPin, INPUT_PULLUP);
  pinMode(sclPin, OUTPUT);
  for (int i = 0; i < 16 && digitalRead(sdaPin) == LOW; i++) {
    digitalWrite(sclPin, LOW);
    delayMicroseconds(10);
    digitalWrite(sclPin, HIGH);
    delayMicroseconds(10);
  }
  // STOP condition: SDA ต่ำ -> สูง ขณะ SCL สูง
  pinMode(sdaPin, OUTPUT);
  digitalWrite(sdaPin, LOW);
  delayMicroseconds(10);
  digitalWrite(sclPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(sdaPin, HIGH);
  delayMicroseconds(10);
  pinMode(sdaPin, INPUT_PULLUP);
  pinMode(sclPin, INPUT_PULLUP);
}

// [เพิ่ม] ฟังก์ชันสำหรับรีเซ็ต I2C Bus เมื่อค้าง
// กู้เฉพาะตัวที่เสียจริง — SGP30 ที่ยังอ่านได้ปกติจะไม่ถูกรีเซ็ต
// (การรีเซ็ต SGP30 ทุกครั้งทำให้ TVOC วนกลับไป warmup 15 วิ ไม่นิ่งสักที)
void recoverI2CBus() {
  static uint32_t recoverCount = 0;
  recoverCount++;
  Serial.printf("[System] Bus Hang detected! Recovering I2C... (ครั้งที่ %lu)\n", recoverCount);

  // กู้เฉพาะบัสของ SCD40 (ตัวที่ trigger) ตามขาที่มันอยู่จริง ถ้า SGP30 ถูกต่อคนละคู่ขา
  // มันจะอยู่คนละบัสและไม่โดนกระทบเลย
  scdWire->end();
  delay(50);
  i2cBusClear(scd_sda, scd_scl);
  i2cBeginWithPullups(scdWire, scd_sda, scd_scl);
  delay(50);

  // SCD40: begin() เฉย ๆ ไม่ทำให้กลับมาวัด — ต้อง restart periodic measurement
  scd40.begin(*scdWire, SCD40_I2C_ADDR_62);
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
    if (sgp30.begin(*sgpWire) == true) {
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

// เคาะ address เดียวบนบัสที่ระบุว่ามีใครรับสายมั้ย — ถูกกว่าการกวาดทั้งบัส 112 address
// จึงเรียกได้บ่อยทุกรอบ discovery โดยไม่กวนเซนเซอร์ตัวที่กำลังทำงานอยู่
static bool i2cProbe(TwoWire* bus, uint8_t addr) {
  bus->beginTransmission(addr);
  return bus->endTransmission() == 0;
}

// ==========================================================================
// I2C แบบ bit-bang บนขาอะไรก็ได้ — ใช้กวาดหาว่าเซนเซอร์ถูกต่ออยู่คู่ขาไหนจริง ๆ
//
// จำเป็นเพราะ hardware I2C ผูกกับขาที่ begin() ไว้แล้วเท่านั้น ถ้าสายไปเสียบผิดคู่ขา
// การสแกน address บนบัสเดิมจะไม่มีวันเจอ ต่อให้เซนเซอร์ยังดีอยู่ทุกประการ
// จำลอง open-drain: LOW = ดึงลงจริง, HIGH = ปล่อยเป็น input + pull-up ภายใน
// ==========================================================================
#define BB_DELAY_US 6      // ครึ่งคาบ ~80 kHz

static inline void bbSdaHigh(int p) { pinMode(p, INPUT_PULLUP); }
static inline void bbSdaLow (int p) { pinMode(p, OUTPUT); digitalWrite(p, LOW); }
static inline void bbSclHigh(int p) { pinMode(p, INPUT_PULLUP); }
static inline void bbSclLow (int p) { pinMode(p, OUTPUT); digitalWrite(p, LOW); }
static inline bool bbSdaRead(int p) { pinMode(p, INPUT_PULLUP); return digitalRead(p); }
static inline void bbTick()         { delayMicroseconds(BB_DELAY_US); }

static void bbRelease(int sda, int scl) {
  pinMode(sda, INPUT);
  pinMode(scl, INPUT);
}

static void bbStart(int sda, int scl) {
  bbSdaHigh(sda); bbSclHigh(scl); bbTick();
  bbSdaLow(sda);  bbTick();
  bbSclLow(scl);  bbTick();
}

static void bbStop(int sda, int scl) {
  bbSdaLow(sda);  bbTick();
  bbSclHigh(scl); bbTick();
  bbSdaHigh(sda); bbTick();
}

static bool bbWriteByte(int sda, int scl, uint8_t data) {
  for (int i = 0; i < 8; i++) {
    if (data & 0x80) bbSdaHigh(sda); else bbSdaLow(sda);
    data <<= 1;
    bbTick();
    bbSclHigh(scl); bbTick();
    bbSclLow(scl);  bbTick();
  }
  bbSdaHigh(sda); bbTick();       // ปล่อยขาให้ slave ตอบ ACK
  bbSclHigh(scl); bbTick();
  bool ack = (bbSdaRead(sda) == LOW);
  bbSclLow(scl);  bbTick();
  return ack;
}

static bool bbProbe(int sda, int scl, uint8_t addr) {
  bbStart(sda, scl);
  bool ack = bbWriteByte(sda, scl, (addr << 1) | 0);
  bbStop(sda, scl);
  return ack;
}

// ปล่อยสองขาแล้วต้องอ่านได้ HIGH ทั้งคู่ ถ้าขาไหนค้างต่ำแปลว่าคู่นั้นช็อต ถูกอย่างอื่นขับอยู่
// หรือเป็นขา input-only — probe ไปก็ได้แต่ขยะ
static bool bbPairUsable(int sda, int scl) {
  pinMode(sda, INPUT_PULLUP);
  pinMode(scl, INPUT_PULLUP);
  delayMicroseconds(50);
  bool ok = (digitalRead(sda) == HIGH) && (digitalRead(scl) == HIGH);
  bbRelease(sda, scl);
  return ok;
}

// คู่ขาที่แทบทุก address ตอบ ACK = SDA ค้างต่ำ ไม่ใช่มีเซนเซอร์ร้อยตัว
static bool bbBusLooksStuck(int sda, int scl) {
  int count = 0;
  for (uint8_t a = 0x08; a <= 0x77 && count <= 20; a++) {
    if (bbProbe(sda, scl, a)) count++;
  }
  bbRelease(sda, scl);
  return count > 20;
}

// ขาที่ยอมให้กวาด — ต้องตัดขาที่ต่อกับ SPI flash/PSRAM/USB/UART0 ออก ไม่งั้นการขับขาพวกนั้น
// เป็น OUTPUT จะทำให้บอร์ดแครชกลางบูต (26-32 flash, 33-37 PSRAM, 19/20 USB, 43/44 UART0,
// 0/3/45/46 strapping) และตัดขา PMS7003 (4/5) ออกด้วยเพราะจองไว้ให้ UART2 แล้ว
static const int CANDIDATE_PINS[] = {
  1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 47, 48
};
static const int NUM_CANDIDATES = sizeof(CANDIDATE_PINS) / sizeof(CANDIDATE_PINS[0]);

struct PinHit {
  bool ok;
  int  sda, scl;
};

// กวาดทุกคู่ขาเพื่อหา address ที่ยังหาไม่เจอบนบัสปัจจุบัน
// skipPin* = ขาของเซนเซอร์ที่กำลังทำงานอยู่ ห้ามแตะ ไม่งั้นการขับขาเป็น OUTPUT
// จะทำให้ตัวที่ยังอ่านได้ดีสะดุดไปด้วย
static void bbSweep(bool needScd, bool needSgp, PinHit& hitScd, PinHit& hitSgp,
                    int skipPinA, int skipPinB) {
  hitScd = { false, -1, -1 };
  hitSgp = { false, -1, -1 };
  if (!needScd && !needSgp) return;

  Serial.println("[PinScan] sweeping GPIO pairs for missing sensors...");
  unsigned long t0 = millis();
  int tested = 0;

  for (int i = 0; i < NUM_CANDIDATES; i++) {
    for (int j = 0; j < NUM_CANDIDATES; j++) {
      if (i == j) continue;
      // หาครบตามที่ต้องการแล้วก็หยุด ไม่ต้องกวาดให้ครบทุกคู่
      if ((!needScd || hitScd.ok) && (!needSgp || hitSgp.ok)) goto done;

      int sda = CANDIDATE_PINS[i];
      int scl = CANDIDATE_PINS[j];
      if (sda == skipPinA || sda == skipPinB || scl == skipPinA || scl == skipPinB) continue;
      if (!bbPairUsable(sda, scl)) continue;
      tested++;

      bool sawScd = needScd && !hitScd.ok && bbProbe(sda, scl, ADDR_SCD40);
      bool sawSgp = needSgp && !hitSgp.ok && bbProbe(sda, scl, ADDR_SGP30);
      bbRelease(sda, scl);
      if (!sawScd && !sawSgp) continue;

      if (bbBusLooksStuck(sda, scl)) {
        Serial.printf("[PinScan] SDA=%d SCL=%d: every address ACKs -> SDA stuck low, ignoring\n",
                      sda, scl);
        continue;
      }
      if (sawScd) {
        hitScd = { true, sda, scl };
        Serial.printf("[PinScan] FOUND SCD40 (0x%02X) on SDA=%d SCL=%d\n", ADDR_SCD40, sda, scl);
      }
      if (sawSgp) {
        hitSgp = { true, sda, scl };
        Serial.printf("[PinScan] FOUND SGP30 (0x%02X) on SDA=%d SCL=%d\n", ADDR_SGP30, sda, scl);
      }
      delay(1);   // เลี้ยง watchdog
    }
    yield();
  }

done:
  Serial.printf("[PinScan] done: %d pairs tested in %.1fs\n", tested, (millis() - t0) / 1000.0);
  if (needScd && !hitScd.ok) Serial.println("[PinScan] SCD40 not on any pin pair — power or sensor itself");
  if (needSgp && !hitSgp.ok) Serial.println("[PinScan] SGP30 not on any pin pair — power or sensor itself");
}

// สแกนบัส I2C แล้วรายงานว่าใครตอบบ้าง (SCD40 = 0x62, SGP30 = 0x58)
// ใช้แยกให้ขาดว่า "เซนเซอร์ค้าง" (ตอบ address แต่ไม่ให้ข้อมูล) ต่างจาก "ไม่มีใครอยู่บนบัส"
// (สายหลุด/ไฟไม่เข้า/พูลอัพหาย) ซึ่งซอฟต์แวร์แก้ไม่ได้ และเป็นคนละปัญหากันคนละทาง
//
// คืนผลลัพธ์ออกไปด้วย ไม่ใช่แค่พิมพ์ทิ้ง: ผู้เรียกต้องรู้ว่า address ที่เราคาดหวังตอบมั้ย
// จะได้ไม่ต้องเสียเวลา init ตัวที่ไม่มีตัวตนอยู่บนบัส
struct I2cScanResult {
  bool scd40;
  bool sgp30;
  int  count;
};

static I2cScanResult i2cScan(TwoWire* bus) {
  I2cScanResult r = { false, false, 0 };
  Serial.print("[I2C] scanning bus...");
  for (uint8_t addr = 0x08; addr < 0x78; addr++) {
    if (i2cProbe(bus, addr)) {
      Serial.printf(" 0x%02X", addr);
      r.count++;
      if (addr == ADDR_SCD40) r.scd40 = true;
      if (addr == ADDR_SGP30) r.sgp30 = true;
    }
  }
  if (r.count == 0) {
    Serial.println(" NOTHING RESPONDS — check SDA/SCL wiring, 3V3 power and pull-ups");
  } else {
    Serial.printf("  (%d device%s)\n", r.count, r.count == 1 ? "" : "s");
  }

  // บอกให้ชัดว่าตัวไหนหาย ไม่ปล่อยให้คนอ่าน log ต้องจำเองว่า 0x62 คือใคร
  if (!r.scd40 || !r.sgp30) {
    Serial.print("[I2C] MISSING:");
    if (!r.scd40) Serial.printf(" SCD40(0x%02X)", ADDR_SCD40);
    if (!r.sgp30) Serial.printf(" SGP30(0x%02X)", ADDR_SGP30);
    Serial.println();
  }
  // มีตัวที่ไม่รู้จักตอบ = ต่อผิดตัวหรือ address jumper ผิด ซึ่งดูจาก "หาย" อย่างเดียวไม่ออก
  int expected = (r.scd40 ? 1 : 0) + (r.sgp30 ? 1 : 0);
  if (r.count > expected) {
    Serial.printf("[I2C] %d unexpected device(s) on the bus — check you wired the right sensor\n",
                  r.count - expected);
  }
  return r;
}

// ถ้าเซนเซอร์ตัวไหนไม่ตอบบนขาที่ตั้งไว้ ให้กวาดหาขาจริงแล้วย้ายบัสตามที่เจอ
// คืนค่า true เมื่อมีการย้ายขาเกิดขึ้น (ผู้เรียกต้อง init เซนเซอร์ตัวนั้นใหม่)
static bool relocateMissingSensors(bool haveScd, bool haveSgp) {
  PinHit hitScd, hitSgp;
  // ห้ามแตะขาของตัวที่ยังทำงานอยู่: การกวาดจะขับขาเป็น OUTPUT ซึ่งจะพังการสื่อสารของมัน
  int skipA = haveScd ? scd_sda : (haveSgp ? sgp_sda : -1);
  int skipB = haveScd ? scd_scl : (haveSgp ? sgp_scl : -1);
  bbSweep(!haveScd, !haveSgp, hitScd, hitSgp, skipA, skipB);
  if (!hitScd.ok && !hitSgp.ok) return false;

  if (hitScd.ok) { scd_sda = hitScd.sda; scd_scl = hitScd.scl; }
  if (hitSgp.ok) { sgp_sda = hitSgp.sda; sgp_scl = hitSgp.scl; }

  // ขาเดียวกัน = ต้องใช้บัสเดียวกัน (สายเส้นเดียวกันจะแยกเป็นสอง peripheral ไม่ได้)
  bool shared = (scd_sda == sgp_sda && scd_scl == sgp_scl);

  I2C_0.end();
  I2C_1.end();
  delay(20);
  i2cBeginWithPullups(&I2C_0, scd_sda, scd_scl);
  scdWire = &I2C_0;
  if (shared) {
    sgpWire = &I2C_0;
  } else {
    i2cBeginWithPullups(&I2C_1, sgp_sda, sgp_scl);
    sgpWire = &I2C_1;
  }
  delay(20);

  Serial.printf("[PinScan] bus map: SCD40 SDA=%d SCL=%d (bus 0) | SGP30 SDA=%d SCL=%d (%s)\n",
                scd_sda, scd_scl, sgp_sda, sgp_scl, shared ? "bus 0, shared" : "bus 1");
  Serial.println("[PinScan] ขาไม่ตรงกับ I2C_SDA/I2C_SCL ใน sensors.h — แก้สายหรือแก้ค่าใน header ให้ตรง");
  return true;
}

void initSensors() {
  Serial.println("[Sensors] Initializing...");
  i2cBeginWithPullups(&I2C_0, I2C_SDA_PIN, I2C_SCL_PIN);

  // ==================== SCD40 ====================
  // ถ้าบอร์ดรีเซ็ตกลางการคุยกับเซนเซอร์ (เช่นตอนอัปโหลดเฟิร์มแวร์) slave อาจยังกด SDA
  // ค้างอยู่ตั้งแต่ก่อนบูต begin() จะล้มเหลวทันทีโดยที่บัสยังไม่เคยถูกปลดล็อก
  // เคลียร์บัสก่อนหนึ่งครั้งเสมอ แล้วถ้ายังไม่ผ่านค่อยเคลียร์ซ้ำอีกรอบก่อนยอมแพ้
  i2cBusClear(I2C_SDA_PIN, I2C_SCL_PIN);
  i2cBeginWithPullups(&I2C_0, I2C_SDA_PIN, I2C_SCL_PIN);

  // สแกน "หลัง" เคลียร์บัสเสมอ: ถ้าสแกนก่อน slave ที่ยังกด SDA ค้างจะทำให้ทั้งบัสเงียบ
  // แล้วรายงานว่าไม่มีใครอยู่เลย ทั้งที่อีกบรรทัดถัดมาบัสก็ถูกปลดล็อกแล้ว — โกหกคนอ่าน log
  I2cScanResult scan = i2cScan(&I2C_0);

  // ตัวไหนไม่ตอบบนขาที่ตั้งไว้ ไม่ได้แปลว่าไม่มี — อาจถูกต่อคนละคู่ขา ซึ่ง hardware I2C
  // จะมองไม่เห็นตลอดกาลเพราะมันผูกกับขาที่ begin() ไว้แล้วเท่านั้น กวาดหาขาจริงก่อนยอมแพ้
  if (!scan.scd40 || !scan.sgp30) {
    if (relocateMissingSensors(scan.scd40, scan.sgp30)) {
      scan.scd40 = i2cProbe(scdWire, ADDR_SCD40);
      scan.sgp30 = i2cProbe(sgpWire, ADDR_SGP30);
    }
  }

  scd40_initialized = false;
  // ผูก driver เข้ากับบัสก่อนเสมอ แม้จะไม่มีเซนเซอร์อยู่: readSensors() เรียก
  // getDataReadyStatus() ทุกลูปโดยไม่สนใจ flag ถ้ายังไม่เคย begin() ตัว driver จะถือ
  // pointer ของ TwoWire เป็น null แล้วบอร์ดจะ panic (LoadProhibited) ทันทีที่เข้า loop แรก
  scd40.begin(*scdWire, SCD40_I2C_ADDR_62);

  // ไม่มีใครอยู่ที่ 0x62 = ไม่ต้องเสียเวลา init (แต่ละรอบมี delay 500 ms) ปล่อยให้ discovery
  // ตามเก็บทีหลัง เสียบสายคืนเมื่อไหร่ก็เจอเองโดยไม่ต้องรีบูต
  if (!scan.scd40) {
    Serial.println("[SCD40] absent at boot — discovery will keep looking");
  }
  for (int attempt = 1; attempt <= 2 && !scd40_initialized && scan.scd40; attempt++) {
    scd40.begin(*scdWire, SCD40_I2C_ADDR_62);
    scd40.stopPeriodicMeasurement();
    delay(500);
    if (scd40.startPeriodicMeasurement() == 0) {
      scd40_initialized = true;
      Serial.printf("[SCD40] OK (SDA=%d SCL=%d)%s\n", scd_sda, scd_scl,
                    attempt > 1 ? " — after bus-clear retry" : "");
    } else if (attempt == 1) {
      Serial.println("[SCD40] no response — clearing bus and retrying");
      scdWire->end();
      delay(50);
      i2cBusClear(scd_sda, scd_scl);
      i2cBeginWithPullups(scdWire, scd_sda, scd_scl);
      delay(50);
    } else {
      // ไม่ถือเป็นจุดจบ: readSensors() จะพยายามกู้ต่อทุก 30 วิ เผื่อเซนเซอร์กลับมาเอง
      Serial.println("[SCD40] ERROR — will keep retrying via bus recovery");
    }
  }

  // ==================== SGP30 ====================
  sgp30_initialized = false;
  if (!scan.sgp30) {
    Serial.println("[SGP30] absent at boot — discovery will keep looking");
  } else if (sgp30.begin(*sgpWire) == false) {
    Serial.println("[SGP30] ERROR: answers at 0x58 but init failed");
  } else {
    Serial.printf("[SGP30] OK (SDA=%d SCL=%d) — warming up...\n", sgp_sda, sgp_scl);
    sgp30_initialized = true;
    sgp30_start_ms = millis();
    sgp30.initAirQuality();
  }

  // ==================== PMS7003 ====================
  // UART ไม่มี address ให้ probe — เปิดพอร์ตแล้วรู้ได้อย่างเดียวว่า "ยังไม่มีเฟรมเข้ามา"
  // จึงไม่ประกาศ OK ตรงนี้: เซนเซอร์ที่ไม่ได้เสียบก็ผ่านบรรทัดนี้ได้เหมือนกัน
  pmsSerial.begin(PMS_BAUD, SERIAL_8N1, PMS_RX_PIN, PMS_TX_PIN);
  delay(100);
  pms.activeMode();
  pms_initialized = true;   // = พอร์ตเปิดแล้ว พร้อมอ่าน ไม่ได้แปลว่าเจอเซนเซอร์
  Serial.println("[PMS7003] UART started — waiting for frames");

  Serial.println("[Sensors] Init complete");
}

bool isSensorReady() {
  if (!sgp30_initialized) return false;
  return (millis() - sgp30_start_ms) >= SGP30_WARMUP_MS;
}

// ค้นหาเซนเซอร์ที่ "ไม่มีข้อมูล" อยู่ตอนนี้ แล้วจัดการตามสาเหตุจริง
//
// หัวใจคือ probe address ก่อนตัดสินใจ ของเดิมแยกไม่ออกระหว่าง
//   (ก) เซนเซอร์อยู่บนบัสแต่ค้าง  -> ต้องล้างบัส
//   (ข) เซนเซอร์ไม่ได้อยู่บนบัสเลย -> ล้างบัสไปก็ไร้ผล มีแต่กวนตัวที่ยังดีอยู่
// แล้วเหมาว่าเป็น (ก) เสมอ ผลคือเวลาสายหลุดจริง เฟิร์มแวร์จะล้างบัสทุก 30 วิไม่มีวันจบ
// และ log ไม่เคยบอกตรง ๆ ว่าตัวไหนหาย
//
// ข้อห้ามของฟังก์ชันนี้: ห้ามแตะ last_*_read และห้ามตั้ง *_valid เด็ดขาด
// ค่าพวกนั้นแปลว่า "วัดได้จริง" การเจอเซนเซอร์กลับมาไม่ใช่การวัด (ดูเหตุผลเต็มที่ readSensors)
static void discoverSensors(unsigned long now) {
  if (last_discovery != 0 && now - last_discovery < DISCOVERY_INTERVAL_MS) return;
  last_discovery = now;

  bool needSweep = false;   // ตั้งเมื่อ address เงียบบนขาชุดปัจจุบัน = อาจถูกต่อคนละคู่ขา

  // ---------- SCD40 ----------
  // ไม่ผูกกับ scd40_initialized โดยตั้งใจ: ถ้า init ล้มเหลวตอนบูต ทางนี้คือทางเดียวที่มันจะกลับมา
  if ((now - last_scd40_read > 30000)
      && (last_scd40_recover == 0 || now - last_scd40_recover > 30000)) {
    last_scd40_recover = now;

    if (!i2cProbe(scdWire, ADDR_SCD40)) {
      // ไม่มีใครอยู่ที่ 0x62 บนขาชุดนี้ — ล้างบัสช่วยไม่ได้ ต้องไปหาว่ามันอยู่ขาไหน
      scd40_initialized = false;
      Serial.printf("[SCD40] not on bus (0x%02X, SDA=%d SCL=%d)\n", ADDR_SCD40, scd_sda, scd_scl);
      needSweep = true;
    } else if (!scd40_initialized) {
      // ตอบ address แต่ยังไม่เคย init สำเร็จ = เพิ่งเสียบกลับมา (hot-plug)
      // init เฉพาะตัวมันพอ ไม่ล้างบัสรวม เพื่อไม่ให้ตัวที่กำลังอ่านได้ดีสะดุด
      scd40.begin(*scdWire, SCD40_I2C_ADDR_62);
      scd40.stopPeriodicMeasurement();
      delay(500);
      if (scd40.startPeriodicMeasurement() == 0) {
        scd40_initialized = true;
        Serial.println("[SCD40] found again — periodic measurement started");
      } else {
        Serial.println("[SCD40] answers but refuses to start measuring");
      }
    } else {
      // ตอบ address, init แล้ว, แต่ไม่มีค่าใหม่มา 30 วิ = ค้างจริง กู้บัสได้เลย
      recoverI2CBus();
    }

    // ทิ้งค่าค้างทันทีทุกกรณี: ไม่ว่าสาเหตุไหน 30 วิที่ผ่านมาก็ไม่มีการวัดใหม่
    // ค่าก่อนหน้าไม่ใช่สภาพอากาศปัจจุบันอีกต่อไป
    currentData.co2 = NAN;
    currentData.temperature = NAN;
    currentData.humidity = NAN;
  }

  // ---------- SGP30 ----------
  // ต้องมีทางกู้ของตัวเอง: เงื่อนไขข้างบนดูแค่ SCD40 ถ้า SCD40 ยังดีอยู่จะไม่มีการกู้เกิดขึ้นเลย
  // แล้ว SGP30 ที่หลุดไป (สายหลวม ไฟกระพริบ ถอดเสียบใหม่) จะเงียบยาวจนกว่าจะรีบูต
  if (!currentData.sgp30_valid && (now - last_sgp30_read > 30000)
      && (last_sgp30_retry == 0 || now - last_sgp30_retry > 30000)) {
    last_sgp30_retry = now;

    if (!i2cProbe(sgpWire, ADDR_SGP30)) {
      sgp30_initialized = false;
      Serial.printf("[SGP30] not on bus (0x%02X, SDA=%d SCL=%d)\n", ADDR_SGP30, sgp_sda, sgp_scl);
      needSweep = true;
    } else if (sgp30.begin(*sgpWire) == true) {
      sgp30.initAirQuality();
      sgp30_start_ms = now;
      sgp30_initialized = true;
      // warmup 15 วิเริ่มนับใหม่ ค่า TVOC/eCO2 ก่อนหน้าจึงไม่ใช่ค่าปัจจุบันแน่นอน
      currentData.tvoc = NAN;
      currentData.eco2 = NAN;
      Serial.println("[SGP30] found again — warming up");
    } else {
      sgp30_initialized = false;
      Serial.println("[SGP30] answers at 0x58 but init failed");
    }
  }

  // ---------- PMS7003 ----------
  // UART ไม่มี address ให้เคาะ สิ่งเดียวที่ทำได้คือสั่ง activeMode ซ้ำ เผื่อเซนเซอร์ตกไป
  // passive mode ตอนไฟตก (อยู่ในนั้นมันจะไม่ส่งอะไรเองจนกว่าจะถูกถาม)
  if (pms_initialized && (now - last_pms_read > 30000)
      && (last_pms_retry == 0 || now - last_pms_retry > 30000)) {
    last_pms_retry = now;
    pms.activeMode();
    currentData.pm2_5 = NAN;
    currentData.pm10  = NAN;
    Serial.println("[PMS7003] silent — re-sent activeMode (check 5V supply and TX->GPIO5)");
  }

  // ---------- กวาดหาขาใหม่ ----------
  // ทำเป็นทางสุดท้ายและนาน ๆ ครั้ง (ทุก 60 วิ) เพราะการกวาดขับขาเป็น OUTPUT และกินเวลา
  // ระดับวินาที ระหว่างนั้น BLE จะไม่มีการส่งค่า — ยอมได้เมื่อ "ไม่มีข้อมูลอยู่แล้ว"
  // แต่ไม่คุ้มจะทำถี่กว่านี้เมื่ออีกตัวยังส่งค่าได้ปกติ
  if (needSweep && (last_pin_sweep == 0 || now - last_pin_sweep > 60000)) {
    last_pin_sweep = now;
    bool haveScd = scd40_initialized;
    bool haveSgp = sgp30_initialized;
    if (relocateMissingSensors(haveScd, haveSgp)) {
      // เจอขาใหม่แล้วต้อง init ตัวนั้นซ้ำบนบัสใหม่ ปล่อยให้รอบ discovery ถัดไปทำ
      // โดยรีเซ็ตตัวจับเวลาให้ลองได้ทันที ไม่ต้องรออีก 30 วิ
      last_scd40_recover = 0;
      last_sgp30_retry = 0;
    }
  }
}

// พิมพ์สรุปสถานะครั้งเดียวต่อการเปลี่ยนแปลง — ตอบคำถาม "เจอครบมั้ย" ได้ในบรรทัดเดียว
// ไม่พิมพ์ทุกลูป เพราะ log จะท่วมจนหาบรรทัดที่สำคัญไม่เจอ
static void reportDiscovery() {
  const char* scd = currentData.scd40_valid ? "ok" : (scd40_initialized ? "silent" : "absent");
  const char* sgp = currentData.sgp30_valid ? "ok" : (sgp30_initialized ? "warmup" : "absent");
  const char* pms_s = currentData.pms_valid ? "ok" : "absent";

  static const char* prev_scd = nullptr;
  static const char* prev_sgp = nullptr;
  static const char* prev_pms = nullptr;
  if (scd == prev_scd && sgp == prev_sgp && pms_s == prev_pms) return;
  prev_scd = scd; prev_sgp = sgp; prev_pms = pms_s;

  Serial.printf("[Discovery] SCD40=%s SGP30=%s PMS=%s\n", scd, sgp, pms_s);
}

SensorData readSensors() {
  unsigned long now = millis();

  discoverSensors(now);

  // last_scd40_read = "อ่านค่าได้จริงครั้งล่าสุด" เท่านั้น ห้ามเลื่อนตอน recover:
  // การ recover ไม่ได้ทำให้มีค่าใหม่ ถ้าเลื่อนจะทำให้ scd40_valid (บรรทัดล่าง) กลับเป็น true
  // ทันทีทั้งที่ currentData ยังเป็นค่าค้างจากก่อนบัสแฮงก์ แล้วค่าเก่านั้นจะถูกส่งออก BLE
  // เป็นค่าปัจจุบัน — อาการคือ "รีสตาร์ทแล้วยังขึ้นค่าเดิม" และผิดกฎ §5.6/§14 ที่ห้าม
  // ใช้ค่าเก่าแทนค่าปัจจุบัน ต้องเป็น No Data จนกว่าจะอ่านได้จริง

  // ==================== 1. อ่าน SCD40 ====================
  // พยายามอ่านเสมอ ไม่ผูกกับ scd40_initialized: การกู้บัสจะไร้ผลถ้าเรายังไม่ยอมอ่านหลังกู้
  // สำเร็จ ถ้าไม่มีเซนเซอร์อยู่จริง getDataReadyStatus() ก็คืนค่าล้มเหลวเงียบ ๆ ตามเดิม
  {
    bool isReady = false;
    if (scd40.getDataReadyStatus(isReady) == 0 && isReady) {
      uint16_t co2; float t, h;
      if (scd40.readMeasurement(co2, t, h) == 0 && co2 > 0) {
        currentData.co2 = (float)co2;
        currentData.temperature = t;
        currentData.humidity = h;
        last_scd40_read = now;
        if (!scd40_initialized) {
          scd40_initialized = true;
          Serial.println("[SCD40] came back after bus recovery");
        }
      }
    }
  }
  // last_*_read == 0 แปลว่า "ยังไม่เคยอ่านสำเร็จเลย" ต้องเช็คแยกเสมอ ไม่งั้นช่วงวินาทีแรก
  // หลังบูต (now ยังน้อยกว่าเกณฑ์) จะถูกนับว่าเพิ่งอ่านสำเร็จ แล้ว currentData ที่ยังเป็น 0
  // จากการ zero-init จะถูกส่งออกเป็นค่าที่วัดได้จริง — ศูนย์ที่แยกไม่ออกจากอากาศสะอาด
  currentData.scd40_valid = (last_scd40_read != 0) && (now - last_scd40_read < 10000);

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
  currentData.sgp30_valid = (last_sgp30_read != 0) && (now - last_sgp30_read < 5000) && isSensorReady();

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
  currentData.pms_valid = (last_pms_read != 0) && (now - last_pms_read < 5000);

  currentData.all_valid = (currentData.scd40_valid && currentData.pms_valid && currentData.sgp30_valid);
  reportDiscovery();
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
