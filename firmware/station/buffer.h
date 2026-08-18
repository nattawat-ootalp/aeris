// Aeris Station — telemetry ring buffer for samples the broker was not reachable for.
// Mirrors firmware/portable/buffer.h; the station's hop is WiFi/MQTT rather than BLE.
#ifndef BUFFER_H
#define BUFFER_H

#include <Arduino.h>

// Six hours at the 30 s telemetry cadence, ~26 KB of SRAM. Sized for the outage that actually
// happens to a fixed node — the AP reboots, the uplink drops overnight — rather than for an
// all-day one, which no amount of SRAM would cover.
#define STATION_BUFFER_CAPACITY 720

// AQI classes as an index rather than the `const char*` from ModelResult. Storing the pointer
// would work only for as long as every one of those strings stays a literal, and would fail
// silently and much later if one ever became a String's buffer.
#define AQI_CLASS_COUNT 6
extern const char* const AQI_CLASSES[AQI_CLASS_COUNT];

// Index of `name` in AQI_CLASSES, or 0 ("Unknown") when it is not one of them. Resolving at
// push time keeps the buffer independent of where the caller's pointer came from.
uint8_t aqiIndex(const char* name);

// Exactly the fields publishTelemetry() puts on the wire, and nothing else. RSSI and uptime are
// included because they describe the moment of measurement; replaying the values from the
// moment of delivery would report the link that finally worked, not the one that failed.
struct StationSample {
  uint32_t ts;          // epoch seconds from NTP. A sample is never buffered without one.
  uint32_t uptime_sec;
  float pm2_5, pm10, co2, tvoc, temperature, humidity;
  int8_t rssi;          // dBm; the ESP32 reports roughly -30..-100, so int8 is ample
  uint8_t aqi;          // index into AQI_CLASSES
  uint8_t anomaly;      // 0/1 — the edge inference's verdict at capture time
};

// Append a sample. When full, the OLDEST is discarded and the drop is counted: a node that
// reconnects with six hours of history ending before the present is more misleading than one
// that admits it lost the beginning.
void bufferPush(const StationSample& sample);

// Copy the oldest sample without removing it. False when empty. Peek-then-pop exists so a
// sample is only dropped once the broker has actually accepted the publish.
bool bufferPeek(StationSample& out);

// Discard the oldest sample. No-op when empty.
void bufferPop();

// Samples waiting to be published.
size_t bufferCount();

// Samples lost to the capacity limit since boot. Reported on the health topic.
uint32_t bufferDropped();

#endif // BUFFER_H
