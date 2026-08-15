// Aeris Portable — Node Configuration Template
// วิธีใช้: คัดลอกไฟล์นี้เป็น config.h แล้วแก้ค่าให้ตรงกับอุปกรณ์
// (config.h ถูก gitignore ไว้)
#ifndef CONFIG_H
#define CONFIG_H

// ===== Device identity =====
// ใช้เป็นส่วนหนึ่งของชื่อโฆษณา BLE: "Aeris-P<DEVICE_ID_SUFFIX>"
// ถ้าเว้นว่าง firmware จะสร้างจาก 2 byte สุดท้ายของ MAC address แทน
#define DEVICE_ID_SUFFIX ""

// portable ไม่ใช้ WiFi/MQTT — ส่งข้อมูลผ่าน BLE ไปที่แอปมือถือเท่านั้น
// (ดู docs/ble-contract.md สำหรับ GATT contract ที่ firmware+app ต้องตรงกัน)


// ===== SOS button (optional hardware) =====
// Define SOS_BUTTON_PIN to the GPIO of a momentary button wired to GND (internal
// pull-up is enabled in firmware). Leave it undefined on builds with no button:
// sosButtonPressed() then always returns false and no SOS is ever raised by the device.
// The button reports a press only. The phone decides what to record, applies the user's
// location-consent setting, and shows the user's own action plan (docs/ble-contract.md).
// #define SOS_BUTTON_PIN 4
#define SOS_BUTTON_HOLD_MS 1500   // hold this long to avoid accidental pocket presses

#endif // CONFIG_H
