/**
 * Build guard: fail if client source reintroduces hardcoded configuration or stand-in data.
 *
 * Every value that differs between a developer machine and a shipped build must come from an
 * EXPO_PUBLIC_* environment variable, and no screen may ship sample/placeholder readings —
 * a fabricated value is indistinguishable from a measured one once it is on screen.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const RULES = [
  {
    id: 'device-id',
    // e.g. BKK-TRT-003 — a station code baked into the bundle goes stale silently.
    re: /['"`][A-Z]{2,4}-[A-Z]{2,4}-\d{2,4}['"`]/,
    message: 'hardcoded device/station id — resolve it at runtime or via EXPO_PUBLIC_DEFAULT_DEVICE_ID',
  },
  {
    id: 'placeholder-key',
    re: /YOUR_[A-Z_]*KEY|<your[- ]?key>|changeme|xxxxxxxx/i,
    message: 'placeholder API key — leave the value empty and render an explicit notice instead',
  },
  {
    id: 'remote-url',
    // Literal https hosts belong in env. api.longdo.com is the map SDK loaded inside the
    // WebView document itself, not a configurable backend, so it is allowed.
    re: /['"`]https?:\/\/(?!localhost|127\.0\.0\.1|api\.longdo\.com|placeholder\.supabase\.co)[^'"`]+['"`]/,
    message: 'hardcoded remote URL — read it from an EXPO_PUBLIC_* variable',
  },
  {
    id: 'sample-data',
    re: /\b(MOCK|FAKE|DUMMY|SAMPLE)_[A-Z_]+\b|\bmockData\b|\bfakeData\b|\bsampleData\b/,
    message: 'sample/mock dataset in client source — read the value from the API',
  },
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const failures = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    // Comments describe the rules themselves; only executable lines are checked.
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (!code.trim() || code.trim().startsWith('*')) return;
    for (const rule of RULES) {
      if (rule.re.test(code)) {
        failures.push(`${file.replace(SRC, 'src/')}:${i + 1}: ${rule.id}: ${rule.message}\n    ${line.trim()}`);
      }
    }
  });
}

if (failures.length) {
  console.error(`✗ no-hardcode check failed (${failures.length}):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('✓ no-hardcode check passed (config from env, no sample data in client source)');
