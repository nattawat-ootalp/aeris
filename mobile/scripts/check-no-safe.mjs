/**
 * Medical-safety lint (TDD §7, §14): the word "SAFE"/"Safe" must never appear as a
 * status label or assurance in the UI. The WatchStatus union already makes it a type
 * error to assign it to a status field; this is the belt-and-suspenders check that also
 * catches JSX text and stray string literals.
 *
 * Strategy: strip comments (doc comments legitimately discuss the banned word), then
 * flag any string literal or JSX text node whose value is exactly "safe"/"SAFE".
 * src/safety.ts holds the intentional guard constant and is exempt.
 *
 * Zero dependencies — runnable with plain `node`. Exit 1 on any violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const EXEMPT = new Set(['safety.ts']); // intentional guard: `const BANNED_ASSURANCE = 'SAFE'`

/** Recursively collect .ts/.tsx files under a directory. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !EXEMPT.has(name)) out.push(p);
  }
  return out;
}

/** Remove // line comments and block comments so doc text is not scanned. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// A string literal whose entire content is safe/SAFE, or JSX text equal to it.
const LITERAL = /(['"`])\s*safe\s*\1/i;
const JSX_TEXT = />\s*safe\s*</i;

let violations = 0;
for (const file of walk(SRC)) {
  const code = stripComments(readFileSync(file, 'utf8'));
  code.split('\n').forEach((line, i) => {
    if (LITERAL.test(line) || JSX_TEXT.test(line)) {
      violations += 1;
      console.error(`SAFE-assurance violation: ${file}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (violations > 0) {
  console.error(`\n${violations} medical-safety violation(s): "SAFE" must not be a status/assurance.`);
  process.exit(1);
}
console.log('check-no-safe: OK — no "SAFE" status/assurance found.');
