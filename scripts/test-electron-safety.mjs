// Tests the guard in scripts/check-electron-safety.mjs against the shapes it
// exists to catch, including the ones no single line contains.
//
// WHY: the check is only worth having if it fires. It was line-based once, and
// a call the formatter wrapped -- loadURL( on one line, the URL on the next --
// matched nothing, so a remote load into the privileged renderer passed the
// gate. A guard that silently stops guarding is worse than no guard, because
// the build still goes green.

import assert from 'node:assert/strict';
import { scan } from './check-electron-safety.mjs';

const cases = [
  {
    name: 'a remote load on one line',
    file: 'app/main.ts',
    source: `win.loadURL('https://example.com/app');`,
    expect: ['remote-window-content']
  },
  {
    name: 'the same load wrapped across lines',
    file: 'app/main.ts',
    source: `win.loadURL(\n  'https://example.com/app'\n);`,
    expect: ['remote-window-content']
  },
  {
    name: 'a local load',
    file: 'app/main.ts',
    source: `win.loadURL('http://localhost:4200');`,
    expect: []
  },
  {
    name: 'an HTML sink in the renderer',
    file: 'src/app/results.component.ts',
    source: `element.innerHTML = result.value;`,
    expect: ['renderer-html-sink']
  },
  {
    name: 'an HTML sink wrapped across lines',
    file: 'src/app/results.component.ts',
    source: `element\n  .innerHTML\n  = result.value;`,
    expect: ['renderer-html-sink']
  },
  {
    name: 'a rule that does not apply to this process',
    file: 'app/main.ts',
    source: `element.innerHTML = trusted;`,
    expect: []
  }
];

for (const testCase of cases) {
  const { findings } = scan(testCase.file, testCase.source);
  assert.deepEqual(
    findings.map(finding => finding.rule.id),
    testCase.expect,
    `${testCase.name}: expected ${testCase.expect.join(', ') || 'no finding'}`
  );
}

// A waiver silences a finding, and only with a reason -- on the line, the line
// above it, or any further line the match itself spans.
const waivedCases = [
  { file: 'src/app/notice.component.ts', source: `element.innerHTML = LEGAL; // electron-safety-ok: module constant` },
  { file: 'src/app/notice.component.ts', source: `// electron-safety-ok: module constant\nelement.innerHTML = LEGAL;` },
  { file: 'app/main.ts', source: `win.loadURL(\n  'https://example.com/status'); // electron-safety-ok: the vendor's own status page` }
];
for (const { file, source } of waivedCases) {
  const result = scan(file, source);
  assert.equal(result.findings.length, 0, `expected a waiver to apply:\n${source}`);
  assert.equal(result.waived.length, 1, `expected exactly one waived finding:\n${source}`);
}

const bareMarker = scan('src/app/notice.component.ts', `element.innerHTML = LEGAL; // electron-safety-ok:`);
assert.equal(bareMarker.findings.length, 1, 'a waiver without a reason must not silence a finding');

console.log(`electron safety guard: ${cases.length + waivedCases.length + 1} cases passed.`);
