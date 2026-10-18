# Reviewing a change

Passing the gate is not the same as being read. `bin/review` hands a change to a
reviewing CLI along with [the brief](brief.md), which says what this codebase
must never get wrong.

This is how the code is worked on, not something the tool does, so it is kept
out of the published documentation.

```bash
bin/review                  # the commits not yet recorded as reviewed
bin/review <a>..<b>         # a range; recorded when it ends at HEAD
bin/review <commit-sha>     # one commit, without recording it
bin/review --uncommitted    # the working tree, before committing
bin/review --pending        # list the commits not yet recorded as reviewed
bin/review --mark [sha]     # record a commit (default HEAD) as reviewed
bin/review --verify ...     # add a pass that tries to refute the findings
```

## The ledger

The ledger records which commits have been read. It lives in the clone's git
directory, at `.git/reviewed-commits.txt`, so recording a read never adds a
commit. Set `REVIEW_LEDGER` in `.env` to keep it somewhere that outlives the
clone. Each line holds a commit, its patch-id, the time and the subject.

A bare `bin/review` reads every commit on `HEAD` that the ledger does not
account for, and records them when the reader finishes cleanly. The list is
fixed before the reader starts, so a commit that lands during a review is not
recorded as read. A single-commit or working-tree read is a re-read and records
nothing.

`git land` rebase-merges, so each commit gets a new identity on master. The
ledger matches a commit by its patch-id as well as its identity, so a commit
read on its branch is not read again after it lands.

An empty ledger starts ten commits back. Anything older is deemed shipped.

## The verify pass

One pass that both finds and reports has nothing pushing back on it, and that is
where false positives are. `--verify` gives the findings to a second pass with
one job: refute each one. It answers CONFIRMED, REFUTED or UNVERIFIED, with the
file and line that settles it, and reports only what survives. It doubles the
cost of a run, so it is off unless asked. `REVIEW_VERIFY=1` in `.env` makes it
the default.

## Naming the reader

The reviewing CLI is named by `REVIEW_AGENT`, in the untracked `.env` or in your
shell profile, so the repository carries no vendor name and the reader can be
swapped without editing anything. It is a command line, so a reader that wants a
subcommand and one that wants a flag are both a setting:

```bash
REVIEW_AGENT='<your-review-cli> <subcommand>'
REVIEW_AGENT_STDIN=1                  # for a reader that takes the prompt on stdin
REVIEW_AGENT_FALLBACK='<another-cli> ...'
```

`REVIEW_AGENT_FALLBACK` is a second reader for when the first is out of usage.
The script switches only when the first exits non-zero with a message matching
`REVIEW_LIMIT_PATTERN` (default `usage limit|rate limit|quota`), so a finding
that mentions a limit never triggers it. A reader that exits cleanly without
printing a review counts as not having reviewed, because some CLIs exit 0 after
refusing a command they needed. A run that no reader finishes records nothing.

Only the `REVIEW_` keys are read from `.env`. A CLI that reads a diff has no
business inheriting the database password.

## What comes back, and what to do with it

Findings are not orders. Each one is checked before it is acted on — the useful
ones come with the input and the wrong row they produce, and a claim like that
can be turned into a test. When a finding is right, the fix and the test that
fails without it land together. When it is wrong, the reasoning goes into the
code as a test or a comment, so the same finding does not have to be argued
twice.

Two examples from the same afternoon, both worth keeping:

- *A frame the instrument sends again is appended twice, and the duplicated
  order is saved as a failure against a sample that has a result.* True, and
  reproducible in the harness in eight lines. Fixed, with that harness case as
  the guard.
- *The repeated frame should still be kept in the stored transmission.* Declined.
  Framing is gone by the time raw data is read back, so a second copy of a
  record in there cannot be told from a second order — keeping it would mean
  re-processing wrote exactly the row the fix prevents. The test now
  re-processes the stored transmission and finds one order, so the reasoning is
  in the suite rather than in a commit message nobody will find.
