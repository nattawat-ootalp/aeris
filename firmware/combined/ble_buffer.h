// Aeris Portable — telemetry ring buffer for samples the phone was not there to receive.
// Contract: docs/ble-contract.md ("Buffered replay"). Keep both in sync.
#ifndef BLE_BUFFER_H
#define BLE_BUFFER_H

#include <Arduino.h>

// One hour of samples at the 5 s notify cadence. Sized against the disconnect that actually
// happens — the user walks away from the phone, or the phone's screen sleeps and the OS drops
// the link — not against an all-day outage, which no amount of SRAM would cover.
#define TELEMETRY_BUFFER_CAPACITY 720

// Sensor-validity bits. The same rule as the live JSON: a field is absent, never zero. Storing
// a flag instead of a sentinel keeps that distinction through the buffer, so a replayed sample
// omits exactly the fields the live one would have.
#define SAMPLE_FLAG_PM    0x01
#define SAMPLE_FLAG_SCD40 0x02
#define SAMPLE_FLAG_SGP30 0x04

// Packed deliberately: the serialized JSON is ~170 bytes, so buffering the strings would cost
// ~120 KB for the same hour that this costs ~20 KB. The JSON is rebuilt at replay time.
struct BufferedSample {
  uint32_t ts;          // seconds since boot, same clock as the live telemetry `ts`
  float pm25;
  float temperature;
  float humidity;
  uint16_t co2;         // ppm, SCD40 (true NDIR)
  uint16_t tvoc;        // ppb, SGP30
  uint16_t eco2;        // ppm, SGP30 ESTIMATE — never a real CO2 measurement
  uint8_t battery;      // %
  uint8_t quality_pct;  // quality_score * 100; the device-side estimate has no finer resolution
  uint8_t flags;        // SAMPLE_FLAG_*
};

// Append a sample. When the buffer is full the OLDEST is discarded and the drop is counted:
// losing the newest would mean the phone reconnects to an hour of history that stops before
// the present, which is the more misleading of the two.
void bleBufferPush(const BufferedSample& sample);

// Copy the oldest sample without removing it. False when the buffer is empty. Peek-then-pop
// exists so a sample is only dropped once the radio has actually accepted it.
bool bleBufferPeek(BufferedSample& out);

// Discard the oldest sample. No-op when empty.
void bleBufferPop();

// Samples waiting to be delivered.
size_t bleBufferCount();

// Samples lost to the capacity limit since boot. Reported over the status characteristic —
// an unavoidable hole in the record is stated, never hidden.
uint32_t bleBufferDropped();

#endif // BLE_BUFFER_H
