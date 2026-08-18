# Aeris Combined — one board, both pipelines

A demo build that runs the portable path and the station path on the same ESP32-S3, from the
same sensors, at the same time.

## Why it exists

`firmware/portable` proves the BLE path. `firmware/station` proves the MQTT path. Neither
proves the two **agree**, because they run on different boards reading different air — so any
difference between what the app shows and what the dashboard shows could always be the rooms
rather than the code.

This build removes that excuse. One `readSensors()` call feeds both:

```
readSensors()
   ├── BLE  ──▶ phone ──▶ POST /ingest/portable        ──▶ source="portable"
   └── MQTT ──▶ HiveMQ ─▶ bridge ─▶ POST /webhook/telemetry ──▶ source="station"
```

Both land in the same InfluxDB measurement under two device ids, so the pipelines can be
compared reading for reading. If a number differs, the difference is in the pipeline.

## One box, two device ids

Deliberate. The BLE path is identified by the advertising name the phone pairs with; the MQTT
path by `NODE_ID`. Merging them would hide the very thing under test — that the backend
handles two independent sources correctly.

Both paths keep their own cadence, buffer and failure handling: BLE notifies every 5 s, MQTT
publishes every 30 s, so a station frame lines up with every sixth portable frame rather than
with a separate measurement.

## Build settings

**The partition scheme must be changed.** At the board's default the sketch fills 96% of the
app partition, which leaves no room and no OTA slot:

| Partition scheme | App region | This sketch |
|---|---|---|
| Default 4MB with spiffs | 1.31 MB | 96% — do not use |
| **Minimal SPIFFS (1.9MB APP with OTA)** | 1.97 MB | **64%** |

In the Arduino IDE: **Tools → Partition Scheme → Minimal SPIFFS (1.9MB APP with OTA/128KB
SPIFFS)**. On the command line:

```
arduino-cli compile --fqbn "esp32:esp32:esp32s3:PartitionScheme=min_spiffs" firmware/combined
```

For reference, all three sketches at that scheme: portable 30%, station 53%, combined 64%.
The combined build is well under the sum of the other two because both already share the same
sensor stack.

Libraries: NimBLE-Arduino, PubSubClient, ArduinoJson, PMS Library, Sensirion I2C SCD4x,
SparkFun SGP30. All are the ones the two single-path builds already use.

## Configuration

Copy `config.example.h` to `config.h` (gitignored) and fill in both halves — the BLE identity
and SOS pin for the portable path, and the WiFi/MQTT credentials plus `ORG_ID`/`NODE_ID` for
the station path.

`ORG_ID` must match `STATION_ORG` on the bridge (`infra/render.yaml`), and `NODE_ID` must
match a row in the `nodes` table. Change one without the others and the readings publish into
a topic nothing is subscribed to.

WiFi must be **2.4 GHz**. A router merging both bands under one name is the most common reason
this silently never connects.

## Running the demo

Flash, open Serial at 115200, and pair the phone. Every 10 s the sketch prints both paths from
one measurement:

```
┌─ Aeris pipeline ────────────────────────────────────────────
│  measured   PM2.5 3.0  PM10 3.0  CO2 810  23.6C  53%  TVOC 12
│  BLE  →app  CONNECTED    sent 42    buffered 0    lost 0
│  MQTT →cloud CONNECTED   sent 7     buffered 0    lost 0
│  heap       142880 bytes free (min 138204 since boot)
└─────────────────────────────────────────────────────────────
```

Then check both arrived, from outside the board:

```
curl "https://aeris-core-api.onrender.com/nodes/BKK-TRT-003/telemetry"     # station path
curl "https://aeris-core-api.onrender.com/monitor/stations"                # freshness per node
```

The portable path appears under the BLE device id, which the app registers on pairing.

### What to pull the plug on

The demo is more convincing when a path is interrupted, because both buffer rather than drop:

- **Walk the phone out of range.** `buffered` climbs on the BLE line; reconnect and it drains,
  and the app files the backlog as history rather than as the current reading.
- **Turn the WiFi off.** `buffered` climbs on the MQTT line and drains on reconnect, with each
  frame keeping the timestamp it was measured at — so an outage delays delivery without
  moving a reading in time.

Either way the other path keeps running, which is the difference between one board that fails
and a system that degrades.

## Watch the heap

BLE and WiFi share one 2.4 GHz radio and are arbitrated by the coexistence layer. It works,
but it costs airtime and current that neither single-path build pays, and this unit has
already been rebooting under load. Free heap is on every status line for that reason: a fall
towards zero is the signature to look for, and it is the one thing no dashboard downstream can
see. If the board resets during a demo, that line — and whether it prints a fresh boot banner
— is the evidence worth capturing.

## What this build is not

It is not what should be deployed. A fixed station has no reason to run BLE, and a device
carried in a pocket has no reason to hold a TLS connection to a broker. Each single-path build
is smaller, cooler and less likely to reset. This one exists to demonstrate that the two
pipelines agree, and both of the others remain the ones to flash for real use.
