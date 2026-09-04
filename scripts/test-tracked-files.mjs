// Fails when a file that .gitignore excludes is nonetheless tracked.
//
// WHY: adding a rule to .gitignore does nothing to a file git is already
// tracking. The rule reads as though the file is handled, the file keeps being
// committed, and nobody looks again -- which is how a 6 MB compiled binary for
// one developer's machine, belonging to a build tool this project no longer
// uses, sat in every clone for two years.
//
// Either state is defensible on its own. It is disagreeing with itself that
// hides things: ignore it and untrack it, or track it and stop ignoring it.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const tracked = execFileSync('git', ['ls-files', '-i', '-c', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

assert.deepEqual(
  tracked,
  [],
  'These files are tracked and also excluded by .gitignore:\n'
  + tracked.map(file => `  ${file}`).join('\n')
  + '\n\nStop tracking it:      git rm --cached <file>\n'
  + 'or stop ignoring it:  remove the rule from .gitignore'
);

console.log('tracked files: nothing is both ignored and committed.');
