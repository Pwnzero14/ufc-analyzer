#!/usr/bin/env node
/**
 * Build-time guard for invariants that were each a real, shipped bug.
 *
 * Runs from `prebuild`, so a violation stops the build rather than being noticed a
 * month later. Every rule below cost real debugging once, and says which, so a
 * future reader can judge whether they genuinely mean to override it.
 *
 * Escape hatch: put `guard-ok` on the line to exempt it.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
};
// Skip comment lines so a rule cannot fire on prose describing the bug it guards.
const isComment = (l) => /^\s*(\/\/|\/?\*)/.test(l);

const failures = [];
const srcFiles = walk('src');

const scan = (pattern, message) => {
  for (const f of srcFiles) {
    read(f).split('\n').forEach((line, i) => {
      if (isComment(line) || line.includes('guard-ok')) return;
      if (pattern.test(line)) failures.push(f + ':' + (i + 1) + '\n    ' + line.trim() + '\n    -> ' + message);
    });
  }
};

// 1 & 2 - the Archive freeze (2026-08-21). The archive is ~38,700 rows and grows
// every event; a per-item scan inside a render loop cost ~40s of blank skeleton.
scan(/allRows\.find\(/,
  'linear scan over the ~38.7k-row archive. Use the archiveIdx() Map in resolveVsArchive.\n       Keep candidate PRIORITY (Fantasy before Fantasy_PP, ctrl before Control) and first-row-wins.');
scan(/allRows\.filter\(\s*r\s*=>\s*eventDedupeKey\(/,
  'this exact filter ran at 8 sites inside 80-iteration loops. Use rowsForEvent(key).');

// 3 - writes that reported success on failure (2026-08-21). storageSet resolved
// without reading chrome.runtime.lastError, so a rejected write was
// indistinguishable from a stored one: a full quota looked like a dead button.
{
  const src = read('src/analyzer.ts');
  const at = src.indexOf('function storageSet(');
  const fn = at >= 0 ? src.slice(at) : '';
  const bodyTxt = fn.slice(0, fn.indexOf('\n}\n') + 3);
  if (!/runtime\??\.lastError/.test(bodyTxt)) {
    failures.push('src/analyzer.ts (storageSet)\n    -> must read chrome.runtime.lastError. Without it a rejected write\n       resolves as success and the caller silently loses data.');
  }
}

// 4 - the 10MB ceiling (2026-08-21). prop_archive_v1 alone is 6.4MB of
// irreplaceable line history and grows every event.
if (!/"unlimitedStorage"/.test(read('manifest.json'))) {
  failures.push('manifest.json\n    -> "unlimitedStorage" permission missing. The archive is 6.4MB and growing;\n       the default 10MB quota silently rejects writes once reached.');
}

if (failures.length) {
  console.error('\nX ' + failures.length + ' invariant violation(s) - each of these was a real bug once.\n');
  failures.forEach((f) => console.error('  ' + f + '\n'));
  console.error('  Add `guard-ok` to the line only if you genuinely mean to override it.\n');
  process.exit(1);
}
console.log('OK invariants (' + srcFiles.length + ' src files checked)');
