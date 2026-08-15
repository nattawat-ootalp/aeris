// Aeris Portable — BLE GATT layer (NimBLE-Arduino). Contract: docs/ble-contract.md
#include "ble.h"
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <esp_mac.h>

static NimBLEServer* server = nullptr;
static NimBLECharacteristic* telemetryChar = nullptr;
static NimBLECharacteristic* statusChar = nullptr;
static NimBLECharacteristic* commandChar = nullptr;
static NimBLECharacteristic* sosChar = nullptr;
static bool connected = false;

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& info) override {
    connected = true;
    Serial.println("[BLE] Phone connected");
  }
  void onDisconnect(NimBLEServer* s, NimBLEConnInfo& info, int reason) override {
    connected = false;
    Serial.println("[BLE] Phone disconnected — advertising again");
    NimBLEDevice::startAdvertising();
  }
};

// Command characteristic: {"cmd":"interval","sec":5} | {"cmd":"identify"}
// MVP: parsed and logged; interval/identify handling can be wired to power.cpp later.
class CommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& info) override {
    std::string v = c->getValue();
    Serial.printf("[BLE] Command received: %s\n", v.c_str());
  }
};

static String deviceSuffix() {
#ifdef DEVICE_ID_SUFFIX
  if (strlen(DEVICE_ID_SUFFIX) > 0) return String(DEVICE_ID_SUFFIX);
#endif
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char buf[5];
  snprintf(buf, sizeof(buf), "%02X%02X", mac[4], mac[5]);
  return String(buf);
}

void initBLE() {
  String name = "Aeris-P" + deviceSuffix();
  NimBLEDevice::init(name.c_str());
  // no bonding required for MVP pairing; app connects directly to the advertised device
  NimBLEDevice::setSecurityAuth(false, false, false);

  server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  NimBLEService* svc = server->createService(BLE_SERVICE_UUID);

  telemetryChar = svc->createCharacteristic(
      BLE_CHAR_TELEMETRY_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  statusChar = svc->createCharacteristic(
      BLE_CHAR_STATUS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  commandChar = svc->createCharacteristic(
      BLE_CHAR_COMMAND_UUID, NIMBLE_PROPERTY::WRITE);
  commandChar->setCallbacks(new CommandCallbacks());
  // SOS: notify-only. The device reports a button press; it never decides what the press means.
  sosChar = svc->createCharacteristic(
      BLE_CHAR_SOS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  svc->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_SERVICE_UUID);
  adv->setName(name.c_str());
  NimBLEDevice::startAdvertising();

  Serial.printf("[BLE] Advertising as %s\n", name.c_str());
}

bool bleIsConnected() { return connected; }

void bleNotifyTelemetry(const SensorData& data, bool sensorsValid, int battery_pct, float quality_score) {
  // JSON doc kept well under the ~185-byte MTU target from the BLE contract.
  // Measured worst case with tvoc/eco2 included: ~158 bytes (< 180 budget).
  // ArduinoJson v7's JsonDocument is elastic — this capacity is advisory/documentation,
  // not a hard limit — but keep it a realistic ceiling for readers of this file.
  StaticJsonDocument<256> doc;
  bool pmValid = data.pms_valid;
  if (pmValid) {
    doc["pm25"] = data.pm2_5;
  }
  if (data.scd40_valid) {
    doc["temperature"] = data.temperature;
    doc["humidity"] = data.humidity;
  }
  // SGP30 TVOC/eCO2 — omitted entirely when invalid (incl. the 15 s warmup and when the
  // chip is absent). Omission is what tells the phone/backend "no data"; a fabricated 0
  // would read as a real clean-air value. Same invariant as pm25 above.
  if (data.sgp30_valid) {
    doc["tvoc"] = (uint16_t)data.tvoc;   // ppb, integer
    doc["eco2"] = (uint16_t)data.eco2;   // ppm, ESTIMATED from VOC — not a real CO2 measurement
  }
  doc["battery"] = battery_pct;
  // sensor_status reflects PM validity ONLY — an invalid PM sensor must never look like
  // "OK" so the phone/backend never build a PM-based caution on missing data (TDD §5.1/§14).
  // Deliberately NOT folding SGP30 validity in here: a missing/absent SGP30 must never
  // suppress a perfectly good PM reading. SGP30 health is surfaced separately via the
  // Device status characteristic's "sgp30" field (see bleNotifyStatus below).
  doc["sensor_status"] = pmValid ? "OK" : "ERROR";
  doc["quality_score"] = quality_score;
  doc["ts"] = (uint32_t)(millis() / 1000);

  String out;
  serializeJson(doc, out);
  Serial.printf("[BLE] telemetry (%u B): %s\n", (unsigned)out.length(), out.c_str());
  telemetryChar->setValue(out.c_str());
  if (connected) telemetryChar->notify();
}

void bleNotifyStatus(int battery_pct, const char* sensor_status, const char* sgp30_status, const char* fw_version) {
  StaticJsonDocument<192> doc;
  doc["battery"] = battery_pct;
  doc["sensor_status"] = sensor_status;
  doc["fw"] = fw_version;
  // SGP30 health: "OK" | "WARMUP" | "ERROR" — see portable.ino's sgp30StatusString().
  doc["sgp30"] = sgp30_status;
  String out;
  serializeJson(doc, out);
  Serial.printf("[BLE] status (%u B): %s\n", (unsigned)out.length(), out.c_str());
  statusChar->setValue(out.c_str());
  if (connected) statusChar->notify();
}

void bleNotifySos(uint32_t press_ts_sec) {
  // Minimal payload on purpose: the fact of the press and when it happened. No severity, no
  // classification, no location — the phone owns location under the user's consent setting
  // (TDD §9), and no part of the system judges whether this is a medical emergency.
  StaticJsonDocument<96> doc;
  doc["event"] = "sos";
  doc["ts"] = press_ts_sec;
  String out;
  serializeJson(doc, out);
  Serial.printf("[BLE] SOS (%u B): %s
", (unsigned)out.length(), out.c_str());
  if (sosChar == nullptr) return;
  sosChar->setValue(out.c_str());
  // Value is set even when disconnected so a phone that connects later can READ the last
  // event; the notify only fires for a phone that is already listening.
  if (connected) sosChar->notify();
}

bool sosButtonPressed() {
#ifdef SOS_BUTTON_PIN
  // Active-low button with an internal pull-up, debounced by requiring the level to hold.
  // Edge-triggered: one press produces exactly one event, however long the button is held.
  static bool initialised = false;
  static bool wasDown = false;
  static unsigned long downSince = 0;
  if (!initialised) {
    pinMode(SOS_BUTTON_PIN, INPUT_PULLUP);
    initialised = true;
  }
  bool down = (digitalRead(SOS_BUTTON_PIN) == LOW);
  unsigned long now = millis();
  if (down && !wasDown) {
    downSince = now;
    wasDown = true;
    return false;
  }
  if (down && wasDown && downSince != 0 && (now - downSince) >= SOS_BUTTON_HOLD_MS) {
    downSince = 0;          // fire once per press, not repeatedly while held
    return true;
  }
  if (!down) wasDown = false;
  return false;
#else
  return false;             // no SOS button wired on this build
#endif
}
