// Aeris Portable — BLE GATT layer (NimBLE-Arduino). Contract: docs/ble-contract.md
#include "ble.h"
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <esp_mac.h>

static NimBLEServer* server = nullptr;
static NimBLECharacteristic* telemetryChar = nullptr;
static NimBLECharacteristic* statusChar = nullptr;
static NimBLECharacteristic* commandChar = nullptr;
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
  StaticJsonDocument<192> doc;
  bool pmValid = data.pms_valid;
  if (pmValid) {
    doc["pm25"] = data.pm2_5;
  }
  if (data.scd40_valid) {
    doc["temperature"] = data.temperature;
    doc["humidity"] = data.humidity;
  }
  doc["battery"] = battery_pct;
  // sensor_status reflects PM validity — an invalid PM sensor must never look like "OK"
  // so the phone/backend never build a PM-based caution on missing data (TDD §5.1/§14).
  doc["sensor_status"] = pmValid ? "OK" : "ERROR";
  doc["quality_score"] = quality_score;
  doc["ts"] = (uint32_t)(millis() / 1000);

  String out;
  serializeJson(doc, out);
  telemetryChar->setValue(out.c_str());
  if (connected) telemetryChar->notify();
}

void bleNotifyStatus(int battery_pct, const char* sensor_status, const char* fw_version) {
  StaticJsonDocument<128> doc;
  doc["battery"] = battery_pct;
  doc["sensor_status"] = sensor_status;
  doc["fw"] = fw_version;
  String out;
  serializeJson(doc, out);
  statusChar->setValue(out.c_str());
  if (connected) statusChar->notify();
}
