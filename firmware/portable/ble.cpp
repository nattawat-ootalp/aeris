// Aeris Portable — BLE GATT layer (NimBLE-Arduino). Contract: docs/ble-contract.md
#include "ble.h"
#include "buffer.h"
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <esp_mac.h>

static NimBLEServer* server = nullptr;
static NimBLECharacteristic* telemetryChar = nullptr;
static NimBLECharacteristic* statusChar = nullptr;
static NimBLECharacteristic* commandChar = nullptr;
static NimBLECharacteristic* sosChar = nullptr;
static bool connected = false;
static unsigned long connectedAt = 0;

// Discovery and subscribing to the telemetry characteristic take the phone a moment after the
// link comes up. Replaying before that would notify into nothing.
#define REPLAY_START_DELAY_MS 1500
// Notifications per loop pass. The loop runs ~20x/s, so roughly 40 samples/s: a full
// hour-long ring drains in about 20 s without starving the live sample.
#define REPLAY_PER_PASS 2

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& info) override {
    connected = true;
    connectedAt = millis();
    Serial.printf("[BLE] Phone connected - %u buffered sample(s) to replay\n",
                  (unsigned)bufferCount());
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

// Build the telemetry frame from a stored sample. Live and replayed samples go through the
// same function so a buffered reading is byte-identical to the one that would have been sent
// at the time — the ONLY difference is the "buf" marker, which the phone needs in order to
// know the reading describes the past and must not be shown as the current air.
static void buildTelemetryJson(const BufferedSample& s, bool buffered, String& out) {
  // JSON doc kept well under the ~185-byte MTU target from the BLE contract.
  // Measured worst case with tvoc/eco2 included: ~158 bytes (< 180 budget); the "buf" flag
  // adds 10 bytes and only ever appears on replay.
  // ArduinoJson v7's JsonDocument is elastic — this capacity is advisory/documentation,
  // not a hard limit — but keep it a realistic ceiling for readers of this file.
  StaticJsonDocument<256> doc;
  bool pmValid = (s.flags & SAMPLE_FLAG_PM) != 0;
  if (pmValid) {
    doc["pm25"] = s.pm25;
  }
  if (s.flags & SAMPLE_FLAG_SCD40) {
    doc["temperature"] = s.temperature;
    doc["humidity"] = s.humidity;
    // TRUE CO2 from the SCD40's NDIR measurement, ppm. Distinct from the SGP30's "eco2"
    // below, which is only a VOC-derived estimate. Omitted with the rest of the SCD40 block
    // when that sensor is invalid — never a fabricated value.
    doc["co2"] = s.co2;
  }
  // SGP30 TVOC/eCO2 — omitted entirely when invalid (incl. the 15 s warmup and when the
  // chip is absent). Omission is what tells the phone/backend "no data"; a fabricated 0
  // would read as a real clean-air value. Same invariant as pm25 above.
  if (s.flags & SAMPLE_FLAG_SGP30) {
    doc["tvoc"] = s.tvoc;   // ppb, integer
    doc["eco2"] = s.eco2;   // ppm, ESTIMATED from VOC — not a real CO2 measurement
  }
  doc["battery"] = s.battery;
  // sensor_status reflects PM validity ONLY — an invalid PM sensor must never look like
  // "OK" so the phone/backend never build a PM-based caution on missing data (TDD §5.1/§14).
  // Deliberately NOT folding SGP30 validity in here: a missing/absent SGP30 must never
  // suppress a perfectly good PM reading. SGP30 health is surfaced separately via the
  // Device status characteristic's "sgp30" field (see bleNotifyStatus below).
  doc["sensor_status"] = pmValid ? "OK" : "ERROR";
  doc["quality_score"] = s.quality_pct / 100.0f;
  doc["ts"] = s.ts;
  if (buffered) doc["buf"] = true;
  serializeJson(doc, out);
}

static BufferedSample toSample(const SensorData& data, int battery_pct, float quality_score) {
  BufferedSample s = {};
  s.ts = (uint32_t)(millis() / 1000);
  s.battery = (uint8_t)constrain(battery_pct, 0, 100);
  s.quality_pct = (uint8_t)constrain((int)(quality_score * 100.0f + 0.5f), 0, 100);
  // Validity travels as a flag, never as a sentinel value: a replayed sample must omit exactly
  // the fields the live one would have omitted.
  if (data.pms_valid) {
    s.flags |= SAMPLE_FLAG_PM;
    s.pm25 = data.pm2_5;
  }
  if (data.scd40_valid) {
    s.flags |= SAMPLE_FLAG_SCD40;
    s.temperature = data.temperature;
    s.humidity = data.humidity;
    s.co2 = (uint16_t)data.co2;
  }
  if (data.sgp30_valid) {
    s.flags |= SAMPLE_FLAG_SGP30;
    s.tvoc = (uint16_t)data.tvoc;
    s.eco2 = (uint16_t)data.eco2;
  }
  return s;
}

void bleNotifyTelemetry(const SensorData& data, bool sensorsValid, int battery_pct, float quality_score) {
  BufferedSample sample = toSample(data, battery_pct, quality_score);
  String out;
  buildTelemetryJson(sample, false, out);
  Serial.printf("[BLE] telemetry (%u B): %s\n", (unsigned)out.length(), out.c_str());
  // Keep the readable value current either way, so a phone that connects later can READ the
  // latest reading without waiting for the next notify.
  telemetryChar->setValue(out.c_str());

  // A measurement nobody received is a hole in the record, not a non-event. Hold it until a
  // phone is there to take it — the device is the only place it exists.
  if (!connected) {
    bufferPush(sample);
    return;
  }
  if (!telemetryChar->notify()) {
    // The link is up but the stack would not take the packet. Same outcome for the data, so
    // the same treatment: buffer it rather than let it evaporate.
    Serial.println("[BLE] notify refused — buffering the sample");
    bufferPush(sample);
  }
}

void bleServiceBuffer() {
  if (!connected || bufferCount() == 0) return;
  // A phone that has just connected has not necessarily finished discovery and subscribed to
  // the telemetry characteristic yet. Replaying into that window would spend the backlog at
  // the exact moment it finally became deliverable.
  if (millis() - connectedAt < REPLAY_START_DELAY_MS) return;

  // Rate-limited on purpose. Emptying the ring in one pass would outrun the connection
  // interval and every notify past that point fails — turning a full buffer into a fast way
  // to lose it. A few per loop also keeps the live 5 s sample flowing while the backlog moves.
  for (int i = 0; i < REPLAY_PER_PASS; i++) {
    BufferedSample sample;
    if (!bufferPeek(sample)) return;
    String out;
    buildTelemetryJson(sample, true, out);
    telemetryChar->setValue(out.c_str());
    // Pop only once the radio has taken it: a notify that fails must leave the sample queued
    // rather than consume it.
    if (!telemetryChar->notify()) return;
    bufferPop();
  }
}

void bleNotifyStatus(int battery_pct, const char* sensor_status, const char* sgp30_status, const char* fw_version) {
  StaticJsonDocument<192> doc;
  doc["battery"] = battery_pct;
  doc["sensor_status"] = sensor_status;
  doc["fw"] = fw_version;
  // SGP30 health: "OK" | "WARMUP" | "ERROR" — see portable.ino's sgp30StatusString().
  doc["sgp30"] = sgp30_status;
  // Backlog held for a phone that was not listening, and readings the ring had to evict to
  // keep accepting new ones. `dropped` is a hole in the record, so it is stated rather than
  // left for the phone to infer from a gap it cannot tell apart from the device being off.
  doc["buffered"] = (uint32_t)bufferCount();
  doc["dropped"] = bufferDropped();
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
  Serial.printf("[BLE] SOS (%u B): %s\n", (unsigned)out.length(), out.c_str());
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
