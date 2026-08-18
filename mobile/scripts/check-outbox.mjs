/**
 * Behaviour guard for the telemetry outbox and the device-clock anchor.
 *
 * These two modules are the reason a reading survives losing the network, and both fail in
 * ways a type check cannot see: a queue that quietly drops entries still compiles, and a clock
 * that stamps a drained backlog with the present moment still compiles. So they are exercised
 * here instead — the app has no test runner, and the failure mode being guarded against is
 * silent data loss, which is exactly the kind nobody notices without a test.
 *
 * The two modules are transpiled with the local TypeScript and run against stubs, so this
 * needs nothing beyond what is already in devDependencies.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const out = mkdtempSync(join(tmpdir(), 'aeris-outbox-'));

// Run the compiler's own entry point rather than the `tsc` shim, which is a shell script on
// POSIX and a .cmd on Windows and needs different spawning on each.
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
try {
  execFileSync(
    process.execPath,
    [tsc, 'src/lib/outbox.ts', 'src/lib/deviceClock.ts',
     '--ignoreConfig', '--outDir', out, '--rootDir', 'src', '--module', 'esnext',
     '--target', 'es2022', '--moduleResolution', 'bundler', '--skipLibCheck'],
    { stdio: 'ignore', cwd: join(here, '..') },
  );
} catch {
  // tsc exits non-zero over the app-only imports it cannot resolve in this bare invocation.
  // It still emits what is needed; the real type check is `npm run typecheck`.
}

// Point the emitted modules at stubs so the queue's behaviour is observable and deterministic.
writeFileSync(join(out, 'stub-storage.js'), `
const store = new Map();
export default {
  async getItem(k) { return store.has(k) ? store.get(k) : null; },
  async setItem(k, v) { store.set(k, v); },
  async removeItem(k) { store.delete(k); },
};
export function rawStore() { return store; }
`);
writeFileSync(join(out, 'stub-client.js'), `
export let calls = [];
let handler = null;
export function setHandler(fn) { handler = fn; calls = []; }
export async function ingestPortableBatch(readings) {
  calls.push(readings.map((r) => r.timestamp));
  return handler(readings);
}
`);
const outboxPath = join(out, 'lib/outbox.js');
writeFileSync(
  outboxPath,
  readFileSync(outboxPath, 'utf8')
    .replace("'@react-native-async-storage/async-storage'", "'../stub-storage.js'")
    .replace("'../api/client'", "'../stub-client.js'"),
);

const { createDeviceClock } = await import(pathToFileURL(join(out, 'lib/deviceClock.js')));
const ob = await import(pathToFileURL(outboxPath));
const client = await import(pathToFileURL(join(out, 'stub-client.js')));
const storage = await import(pathToFileURL(join(out, 'stub-storage.js')));
const STORAGE_KEY = 'aeris.outbox.portable.v1';

const ok = (readings) => ({ accepted: true, received: readings.length, stored: readings.length, failed: [] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sample = (i) => ({ device_id: 'P001', timestamp: new Date(1_700_000_000_000 + i * 5000).toISOString(), pm25: 10 + i });
const T0 = 1_700_000_000_000;

let failures = 0;
async function test(name, fn) {
  await ob.__resetOutboxForTests();
  try {
    await fn();
  } catch (e) {
    console.error(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
    failures++;
  }
}

// ── deviceClock ──
await test('clock: first sample anchors uptime to the phone clock', () => {
  const c = createDeviceClock();
  assert.equal(c.captureTime(100, 1_000_000), 1_000_000);
});
await test('clock: live samples keep pace with the phone clock', () => {
  const c = createDeviceClock();
  assert.equal(c.captureTime(100, T0), T0);
  assert.equal(c.captureTime(105, T0 + 5_000), T0 + 5_000);
});
await test('clock: a drained buffer keeps each capture moment, not the arrival moment', () => {
  const c = createDeviceClock();
  c.captureTime(100, T0);
  // link drops; the device buffers. On reconnect it dumps 110/115/120 in one burst at +30 s.
  const burst = T0 + 30_000;
  assert.equal(c.captureTime(110, burst), T0 + 10_000);
  assert.equal(c.captureTime(115, burst), T0 + 15_000);
  assert.equal(c.captureTime(120, burst), T0 + 20_000);
});
await test('clock: an hour-long backlog is NOT collapsed onto the present', () => {
  const c = createDeviceClock();
  c.captureTime(100, T0);
  // link down for an hour; the device kept sampling. On reconnect it dumps the whole ring.
  const burst = T0 + 3_600_000;
  assert.equal(c.captureTime(105, burst), T0 + 5_000, 'oldest entry lost its capture time');
  assert.equal(c.captureTime(1900, burst), T0 + 1_800_000);
  assert.equal(c.captureTime(3700, burst), T0 + 3_600_000, 'newest entry should land at now');
});
await test('clock: never dates a reading after it arrived', () => {
  const c = createDeviceClock();
  // the first sample was itself delayed 60 s, so the anchor starts 60 s too late
  c.captureTime(100, T0);
  const t = c.captureTime(40, T0 + 1_000);
  assert.ok(t <= T0 + 1_000, 'capture time ' + t + ' is in the future relative to arrival');
});
await test('clock: a reboot re-anchors instead of dating samples in the past', () => {
  const c = createDeviceClock();
  c.captureTime(3600, 5_000_000);
  const after = c.captureTime(2, 5_100_000);
  assert.equal(after, 5_100_000, 'expected re-anchor to now, got ' + after);
});
await test('clock: a missing ts falls back to arrival time, never a guess', () => {
  const c = createDeviceClock();
  assert.equal(c.captureTime(undefined, 42), 42);
});
await test('clock: reset drops the anchor', () => {
  const c = createDeviceClock();
  c.captureTime(100, 1_000_000);
  c.reset();
  assert.equal(c.captureTime(999, 2_000_000), 2_000_000);
});

// ── outbox ──
await test('outbox: a reading is uploaded and leaves the queue', async () => {
  client.setHandler(ok);
  ob.enqueueReading(sample(0));
  await sleep(20);
  assert.equal(ob.outboxState().pending, 0);
  assert.deepEqual(client.calls, [[sample(0).timestamp]]);
});
await test('outbox: a failed upload keeps the reading instead of losing it', async () => {
  client.setHandler(() => { throw new Error('offline'); });
  ob.enqueueReading(sample(0));
  ob.enqueueReading(sample(1));
  await sleep(20);
  assert.equal(ob.outboxState().pending, 2);
});
await test('outbox: the backlog is replayed once the backend answers', async () => {
  client.setHandler(() => { throw new Error('offline'); });
  for (let i = 0; i < 5; i++) ob.enqueueReading(sample(i));
  await sleep(20);
  assert.equal(ob.outboxState().pending, 5);
  client.setHandler(ok);
  await ob.drainOutbox();
  assert.equal(ob.outboxState().pending, 0);
  // every sample kept its own capture time — not five copies of one instant
  const sent = client.calls.at(-1);
  assert.equal(new Set(sent).size, 5);
  assert.deepEqual(sent, [0,1,2,3,4].map((i) => sample(i).timestamp));
});
await test('outbox: an unreachable backend gets the backlog written to disk', async () => {
  client.setHandler(() => { throw new Error('offline'); });
  for (let i = 0; i < 3; i++) ob.enqueueReading(sample(i));
  await sleep(3200); // the persist is debounced
  const persisted = JSON.parse(storage.rawStore().get(STORAGE_KEY));
  assert.equal(persisted.length, 3);
  assert.deepEqual(persisted.map((r) => r.timestamp), [0, 1, 2].map((i) => sample(i).timestamp));
});
await test('outbox: a backlog left by a previous run is picked up and sent', async () => {
  // exactly what a fresh app launch sees: entries on disk, nothing in memory
  storage.rawStore().set(STORAGE_KEY, JSON.stringify([sample(0), sample(1)]));
  client.setHandler(ok);
  await ob.drainOutbox();
  assert.equal(ob.outboxState().pending, 0);
  assert.deepEqual(client.calls, [[sample(0).timestamp, sample(1).timestamp]]);
});
await test('outbox: a permanently-rejected entry is dropped, not retried forever', async () => {
  client.setHandler((r) => ({ accepted: true, received: r.length, stored: r.length - 1,
    failed: [{ index: 0, error: 'CLOCK_UNSYNCED', retryable: false }] }));
  ob.enqueueReading(sample(0));
  ob.enqueueReading(sample(1));
  await sleep(20);
  assert.equal(ob.outboxState().pending, 0);
});
await test('outbox: a retryable failure stays queued', async () => {
  client.setHandler((r) => ({ accepted: true, received: r.length, stored: r.length - 1,
    failed: [{ index: 1, error: 'STORE_FAILED', retryable: true }] }));
  ob.enqueueReading(sample(0));
  ob.enqueueReading(sample(1));
  await sleep(20);
  assert.equal(ob.outboxState().pending, 1);
});
await test('outbox: the cap drops the OLDEST and reports the loss', async () => {
  client.setHandler(() => { throw new Error('offline'); });
  for (let i = 0; i < ob.MAX_ENTRIES + 10; i++) ob.enqueueReading(sample(i));
  await sleep(20);
  const s = ob.outboxState();
  assert.equal(s.pending, ob.MAX_ENTRIES);
  assert.equal(s.dropped, 10, 'drops must be counted, not silent');
});
await test('outbox: a long backlog is sent in capped batches', async () => {
  client.setHandler(() => { throw new Error('offline'); });
  for (let i = 0; i < 1200; i++) ob.enqueueReading(sample(i));
  await sleep(20);
  client.setHandler(ok);
  await ob.drainOutbox();
  assert.equal(ob.outboxState().pending, 0);
  const sizes = client.calls.map((c) => c.length);
  assert.deepEqual(sizes, [500, 500, 200]);
});
await test('outbox: samples captured mid-upload are not lost or double-sent', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  client.setHandler(async (r) => { await gate; return ok(r); });
  ob.enqueueReading(sample(0));
  await sleep(5);
  ob.enqueueReading(sample(1)); // arrives while the first request is in flight
  release();
  await sleep(30);
  assert.equal(ob.outboxState().pending, 0);
  const allSent = client.calls.flat();
  assert.equal(new Set(allSent).size, allSent.length, 'no entry sent twice');
  assert.equal(allSent.length, 2, 'no entry lost');
});

rmSync(out, { recursive: true, force: true });
if (failures > 0) {
  console.error(`
✗ outbox check failed (${failures} case${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log('✓ outbox check passed (a reading survives a dropped link; a backlog keeps its capture times)');
