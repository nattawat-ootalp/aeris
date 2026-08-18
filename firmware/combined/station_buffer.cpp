// Aeris Station — telemetry ring buffer. See buffer.h.
#include "station_buffer.h"
#include <string.h>   // strcmp — used to resolve an AQI class name to its index

// Index 0 is the fallback for anything the model reports that is not on this list, so an
// unrecognised class never silently becomes "Good".
const char* const AQI_CLASSES[AQI_CLASS_COUNT] = {
  "Unknown", "Good", "Moderate", "Unhealthy", "Very Unhealthy", "Hazardous",
};

uint8_t aqiIndex(const char* name) {
  if (name == nullptr) return 0;
  for (uint8_t i = 0; i < AQI_CLASS_COUNT; i++) {
    if (strcmp(name, AQI_CLASSES[i]) == 0) return i;
  }
  return 0;
}

// Statically allocated (~26 KB): a heap allocation that fails mid-run would silently turn
// buffering off, which is exactly the failure this module exists to prevent.
static StationSample ring[STATION_BUFFER_CAPACITY];
static size_t head = 0;   // index of the oldest sample
static size_t count = 0;
static uint32_t dropped = 0;

void stationBufferPush(const StationSample& sample) {
  if (count == STATION_BUFFER_CAPACITY) {
    head = (head + 1) % STATION_BUFFER_CAPACITY;  // evict the oldest
    count--;
    dropped++;
  }
  ring[(head + count) % STATION_BUFFER_CAPACITY] = sample;
  count++;
}

bool stationBufferPeek(StationSample& out) {
  if (count == 0) return false;
  out = ring[head];
  return true;
}

void stationBufferPop() {
  if (count == 0) return;
  head = (head + 1) % STATION_BUFFER_CAPACITY;
  count--;
}

size_t stationBufferCount() { return count; }

uint32_t stationBufferDropped() { return dropped; }
