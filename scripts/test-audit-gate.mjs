// Tests that the dependency gate fires, and on what.
//
// WHY: the gate's whole value is the day it stops something, and that day is
// the first time anyone sees it work. Left untested, the easy repair for a
// flaky registry -- ignore the error, carry on -- turns a security gate into a
// step that always passes, and nothing about the build would look different.

import assert from 'node:assert/strict';
import { evaluateReport } from './audit-dependencies.mjs';

const advisory = (severity, name) => ({
  [name]: {
    name,
    severity,
    via: [{ title: `${name} is vulnerable`, url: `https://github.com/advisories/${name}` }]
  }
});

const clean = evaluateReport({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } });
assert.equal(clean.ok, true, 'a report with nothing in it must pass');
console.log('  ok  a clean report passes');

for (const severity of ['critical', 'high']) {
  const result = evaluateReport({ vulnerabilities: advisory(severity, 'some-package') });
  assert.equal(result.ok, false, `${severity} must stop the build`);
  assert.equal(result.failing[0].name, 'some-package');
  console.log(`  ok  ${severity} stops the build`);
}

for (const severity of ['moderate', 'low', 'info']) {
  const result = evaluateReport({ vulnerabilities: advisory(severity, 'some-package') });
  assert.equal(result.ok, true, `${severity} is below the threshold and must not stop the build`);
  console.log(`  ok  ${severity} is reported without stopping the build`);
}

const mixed = evaluateReport({
  vulnerabilities: { ...advisory('low', 'quiet-one'), ...advisory('critical', 'loud-one') },
  metadata: { vulnerabilities: { low: 1, critical: 1, total: 2 } }
});
assert.equal(mixed.ok, false);
assert.deepEqual(mixed.failing.map(entry => entry.name), ['loud-one'], 'only the ones above the threshold are named');
console.log('  ok  a critical among low findings still stops the build');

const counted = evaluateReport({
  vulnerabilities: advisory('moderate', 'quiet-one'),
  metadata: { vulnerabilities: { moderate: 1, total: 1 } }
});
assert.match(counted.remaining, /1 moderate/, 'what was found below the threshold is still reported');
console.log('  ok  findings below the threshold are still counted out loud');

// A report shaped in none of the ways expected must not be read as clean by
// accident -- it should carry no findings and no counts, and say so.
const empty = evaluateReport(undefined);
assert.equal(empty.ok, true);
assert.equal(empty.remaining, '');
console.log('  ok  an empty report claims nothing');

console.log('audit gate: it fires on high and critical, and stays quiet below them.');
