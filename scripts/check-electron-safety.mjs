#!/usr/bin/env node
// Guards the assumptions that make this app's Electron configuration safe.
//
// WHY: the renderer runs with nodeIntegration: true and contextIsolation: false
// (app/main.ts), so anything that executes as script in the renderer executes with
// full Node -- the filesystem, the network, the operator's machine. That is not a
// live vulnerability today, and deliberately so: every value reaching the DOM goes
// through Angular interpolation, which escapes it, and the window only ever loads
// the bundled file:// build. No instrument or LIS data can become script.
//
// Those two facts are load-bearing, and nothing in the code says so. A single
// [innerHTML] added to render a formatted result, or one remote URL opened in the
// window, silently converts a rendering convenience into remote code execution --
// and whoever writes that line has no reason to connect it to a webPreferences
// setting written years earlier and never looked at since.
//
// This check exists to make that connection for them, at the moment it matters.
// It is not a general security scanner and does not try to be: it asserts exactly
// the assumptions above, so it stays quiet and stays trusted.
//
// A finding that is genuinely fine can be waived with a reason, on the offending
// line or the line above:
//
//   someElement.innerHTML = TRUSTED_CONSTANT; // electron-safety-ok: literal, no input
//
// A waiver requires a reason -- a bare marker is rejected -- so waiving stays a
// decision someone made rather than a way to silence the check.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const WAIVER = /electron-safety-ok:\s*\S+/;

// Each rule names what it protects, so a failure explains itself without needing
// this file open. `where` narrows a rule to the process it applies to.
const RULES = [
  {
    id: 'renderer-html-sink',
    where: /^src\//,
    pattern: /\[innerHTML\]|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|bypassSecurityTrust\w*/,
    why: 'Writes unescaped HTML into the renderer. Angular escaping is what stops instrument '
       + 'and LIS data becoming script, and script in this renderer has full Node.',
    instead: 'Render through interpolation ({{ value }}) or a property binding. If the markup '
           + 'is genuinely a trusted constant, waive it with a reason.',
  },
  {
    id: 'remote-window-content',
    where: /^app\//,
    // Any http(s) literal handed to loadURL/loadFile. Loopback is the dev server.
    pattern: /load(URL|File)\s*\(\s*[`'"]https?:\/\/(?!localhost|127\.0\.0\.1)/,
    why: 'Loads remote content into a window whose renderer has full Node. Anyone who can '
       + 'influence that response, or sit between you and it, reaches the operator\'s machine.',
    instead: 'Keep the window on the bundled file:// build. Show remote content in the '
           + 'default browser via shell.openExternal instead.',
  },
  {
    id: 'window-escape-hatch',
    where: /^(app|src)\//,
    pattern: /<webview|webviewTag\s*:\s*true|window\.open\s*\(/,
    why: 'Opens a second web context that does not inherit this app\'s safety assumptions, '
       + 'and can be pointed at content the app did not ship.',
    instead: 'Use shell.openExternal for outside links, or an in-app route for app content.',
  },
  {
    id: 'weakened-web-preferences',
    where: /^app\//,
    pattern: /webSecurity\s*:\s*false|allowRunningInsecureContent\s*:\s*true|experimentalFeatures\s*:\s*true/,
    why: 'Removes a browser-level protection this app relies on precisely because its '
       + 'renderer is privileged.',
    instead: 'Leave the default. If a resource will not load, fix the resource.',
  },
  {
    id: 'dynamic-code-execution',
    where: /^(app|src)\//,
    // Bare `eval(` only -- .eval( is Playwright/CDP page evaluation, a different thing.
    pattern: /(?<![.\w])eval\s*\(|new\s+Function\s*\(/,
    why: 'Turns data into code. In this renderer that means turning data into Node.',
    instead: 'Parse it (JSON.parse) or dispatch on a lookup table.',
  },
];

const SCANNABLE = /\.(ts|js|mjs|cjs|html)$/;
// Tests drive the app deliberately, including the unsafe shapes above.
const EXCLUDED = /(^|\/)(node_modules|dist|release)\/|\.spec\.ts$|^e2e\//;

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(f => f && SCANNABLE.test(f) && !EXCLUDED.test(f));

const findings = [];
const waived = [];

for (const file of files) {
  const applicable = RULES.filter(rule => rule.where.test(file));
  if (applicable.length === 0) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const rule of applicable) {
      if (!rule.pattern.test(line)) continue;
      // A waiver on the line itself, or on the line above for wrapped statements.
      const waiver = WAIVER.test(line) || WAIVER.test(lines[index - 1] ?? '');
      (waiver ? waived : findings).push({ rule, file, line: index + 1, text: line.trim() });
    }
  });
}

for (const w of waived) {
  console.log(`  waived  ${w.file}:${w.line}  ${w.rule.id}`);
}

if (findings.length === 0) {
  console.log(`electron safety: ${files.length} files scanned, nothing to report`
    + `${waived.length ? ` (${waived.length} waived)` : ''}.`);
  process.exit(0);
}

console.error('\nelectron safety: this change would weaken what keeps the privileged'
  + ' renderer safe.\n');

for (const rule of RULES) {
  const hits = findings.filter(f => f.rule.id === rule.id);
  if (hits.length === 0) continue;
  console.error(`${rule.id}`);
  for (const hit of hits) console.error(`  ${hit.file}:${hit.line}  ${hit.text}`);
  console.error(`  why:     ${rule.why}`);
  console.error(`  instead: ${rule.instead}\n`);
}

console.error('If one of these is genuinely safe, say why on the line (or the one above):');
console.error('  // electron-safety-ok: <reason>\n');
process.exit(1);
