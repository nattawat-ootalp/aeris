// ══════════════════════════════════════════════════════════════
//  Aeris Combined — Node Configuration Template
//  Copy this file to config.h and fill it in. config.h is gitignored.
//
//  One board runs BOTH pipelines at once, so this file carries the identity for both:
//  the BLE name the phone pairs with, and the WiFi/MQTT credentials plus node id the
//  station path publishes under. The same box therefore appears in the backend as TWO
//  devices — which is the point of the demo, not an accident of the wiring.
// ══════════════════════════════════════════════════════════════
#ifndef CONFIG_H
#define CONFIG_H

// ═══ Portable path (BLE → phone → POST /ingest/portable, source="portable") ═══

// Part of the BLE advertising name: "Aeris-P<DEVICE_ID_SUFFIX>". Left empty, the firmware
// builds one from the last two bytes of the MAC address instead.
#define DEVICE_ID_SUFFIX ""

// Optional momentary button to GND (internal pull-up is enabled in firmware). Leave it
// undefined on a board with no button: sosButtonPressed() then always returns false and the
// device never raises an SOS. The button reports a press only — the phone decides what to
// record and shows the user's own action plan.
// #define SOS_BUTTON_PIN 4
#define SOS_BUTTON_HOLD_MS 1500

// ═══ Station path (WiFi → MQTT/TLS → HiveMQ → bridge → POST /webhook/telemetry,
//     source="station") ═══

// 2.4 GHz only — an ESP32 cannot see a 5 GHz network, and a router that merges both bands
// under one name is the most common reason this silently never connects.
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

#define MQTT_HOST     "xxxxxxxxxxxxxxxx.s1.eu.hivemq.cloud"
#define MQTT_PORT     8883
#define MQTT_USER     "YOUR_MQTT_USERNAME"
#define MQTT_PASS     "YOUR_MQTT_PASSWORD"

// ORG_ID must match STATION_ORG on the bridge (infra/render.yaml), and NODE_ID must match a
// row in the `nodes` table — the topic is built from both, and the API resolves the node by
// the id in the payload. Change one without the others and the readings publish into a topic
// nothing is subscribed to.
#define ORG_ID        "airsentinel-trat"
#define NODE_ID       "BKK-TRT-003"
#define NODE_ZONE     "Zone B"

#endif // CONFIG_H
