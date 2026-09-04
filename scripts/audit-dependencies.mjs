// Fails the build on a known vulnerability in what we ship.
//
// WHY not `npm audit` directly: it exits non-zero for two unrelated reasons --
// a vulnerability was found, and the audit could not be performed. Those
// deserve opposite responses. The first is ours to fix. The second is the
// registry having a bad afternoon: the quick-audit endpoint this tree resolves
// to is being retired, and has started answering 400 with the misleading text
// "Invalid package tree, run npm install" for requests that are nothing of the
// sort. Two of four runs failed that way in one afternoon while the same audit
// passed locally and found nothing.
//
// A gate that cries wolf gets ignored, and a gate that shrugs off "I could not
// check" stops being a gate. So a transport failure is retried, and if it still
// cannot run, it fails saying exactly that -- an audit that never ran is never
// reported as clean.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ATTEMPTS = 3;
const BACKOFF_MS = 5_000;
// What we ship. Development dependencies are not in an installer.
const AUDIT_ARGUMENTS = ['audit', '--omit=dev', '--json'];
const FAILING_SEVERITIES = ['high', 'critical'];

function runAudit() {
  const result = spawnSync('npm', AUDIT_ARGUMENTS, {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  if (result.error) {
    return { ran: false, reason: result.error.message };
  }
  try {
    return { ran: true, report: JSON.parse(result.stdout) };
  } catch {
    const output = (result.stderr || result.stdout || '').trim();
    return { ran: false, reason: output.split('\n').slice(-5).join('\n') };
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Reads a report and says whether it should stop the build.
 *
 * Exported so scripts/test-audit-gate.mjs can hand it reports the registry is
 * unlikely to produce on demand -- a critical advisory in particular. A gate
 * nobody has ever seen fire is a gate nobody knows the shape of.
 * @param report The parsed output of `npm audit --json`
 */
export function evaluateReport(report) {
  const vulnerabilities = Object.values(report?.vulnerabilities ?? {});
  const failing = vulnerabilities.filter(entry => FAILING_SEVERITIES.includes(entry.severity));

  const counts = report?.metadata?.vulnerabilities ?? {};
  const remaining = Object.entries(counts)
    .filter(([severity, count]) => severity !== 'total' && count > 0)
    .map(([severity, count]) => `${count} ${severity}`)
    .join(', ');

  return { ok: failing.length === 0, failing, remaining };
}

function audit() {
  let report = null;
  let lastReason = 'no reason reported';

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const outcome = runAudit();

    if (outcome.ran && !outcome.report?.error) {
      report = outcome.report;
      break;
    }

    // npm reports an audit it could not perform as JSON too, with the useful
    // part in any of three places depending on where it went wrong: a registry
    // that answered with an error fills summary or detail, and one that could
    // not be reached at all leaves both empty and explains itself in message.
    lastReason = outcome.ran
      ? (outcome.report.error?.detail
        || outcome.report.error?.summary
        || outcome.report.message
        || 'no reason given').trim()
      : outcome.reason;

    console.log(`  audit attempt ${attempt} of ${ATTEMPTS} could not be performed: ${lastReason.split('\n')[0]}`);
    if (attempt < ATTEMPTS) {
      sleep(BACKOFF_MS);
    }
  }

  if (!report) {
    console.error('\nThe dependency audit could not be performed, so nothing has been checked.');
    console.error('An audit that did not run is not a clean audit, which is why this fails.');
    console.error('Re-run the job; if it keeps happening, the audit endpoint has changed and');
    console.error(`this check needs to follow it.\n\n${lastReason}\n`);
    process.exit(1);
  }

  const { ok, failing, remaining } = evaluateReport(report);

  if (!ok) {
    console.error('\nProduction dependencies carry known vulnerabilities:\n');
    for (const entry of failing) {
      console.error(`  ${entry.severity.padEnd(8)} ${entry.name}`);
      for (const via of entry.via ?? []) {
        if (typeof via === 'object' && via.title) {
          console.error(`           ${via.title} (${via.url})`);
        }
      }
    }
    console.error('\nUpgrade the dependency rather than lowering the threshold.\n');
    process.exit(1);
  }

  console.log(`dependency audit: nothing at or above high${remaining ? ` (${remaining} below it)` : ''}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  audit();
}
