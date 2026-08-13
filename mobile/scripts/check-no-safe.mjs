/**
 * Medical-safety guard (TDD §7/§14): fail the build if the banned assurance word "Safe"
 * is used as a status VALUE (a quoted literal or JSX text). The typed `WatchStatus` union
 * already makes it a type error; this is defense-in-depth and also covers plain strings.
 *
 * It intentionally does NOT flag `SafeAreaView` (an identifier, not a quoted/JSX status) or
 * prose in comments — only value-position usage.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'App.tsx'];
const EXT = /\.(ts|tsx)$/;
const QUOTED = /(['"`])\s*safe\s*\1/i; // 'Safe' / "safe" / `SAFE`
const JSX_TEXT = />\s*safe\s*</i; //      >Safe<

function files(p) {
  try {
    const s = statSync(p);
    if (s.isFile()) return EXT.test(p) ? [p] : [];
    return readdirSync(p).flatMap((n) => files(join(p, n)));
  } catch {
    return [];
  }
}

let violations = 0;
for (const f of ROOTS.flatMap(files)) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // skip comment lines — prose is allowed to explain the ban; only VALUE usage is flagged
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    const code = line.split('//')[0]; // drop any trailing line-comment
    if (QUOTED.test(code) || JSX_TEXT.test(code)) {
      console.error(`  ${f}:${i + 1}: banned status value "Safe" -> ${line.trim()}`);
      violations++;
    }
  });
}

if (violations > 0) {
  console.error(`\n✗ no-SAFE check failed: ${violations} occurrence(s).`);
  process.exit(1);
}
console.log('✓ no-SAFE check passed (watch vocabulary: Normal / Caution / High / No Data)');
