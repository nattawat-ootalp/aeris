// Aeris Portable — telemetry ring buffer. See buffer.h and docs/ble-contract.md.
#include "ble_buffer.h"

// Statically allocated (~20 KB): a heap allocation that fails mid-run would silently turn
// buffering off, which is exactly the failure this module exists to prevent.
static BufferedSample ring[TELEMETRY_BUFFER_CAPACITY];
static size_t head = 0;   // index of the oldest sample
static size_t count = 0;
static uint32_t dropped = 0;

void bleBufferPush(const BufferedSample& sample) {
  if (count == TELEMETRY_BUFFER_CAPACITY) {
    head = (head + 1) % TELEMETRY_BUFFER_CAPACITY;  // evict the oldest
    count--;
    dropped++;
  }
  ring[(head + count) % TELEMETRY_BUFFER_CAPACITY] = sample;
  count++;
}

bool bleBufferPeek(BufferedSample& out) {
  if (count == 0) return false;
  out = ring[head];
  return true;
}

void bleBufferPop() {
  if (count == 0) return;
  head = (head + 1) % TELEMETRY_BUFFER_CAPACITY;
  count--;
}

size_t bleBufferCount() { return count; }

uint32_t bleBufferDropped() { return dropped; }
