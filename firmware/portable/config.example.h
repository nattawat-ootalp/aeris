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

#endif // CONFIG_H
