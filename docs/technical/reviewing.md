# Reviewing a change

Passing the gate is not the same as being read. `bin/review` hands a change to a
reviewing CLI along with [the brief](review-brief.md), which says what this
codebase must never get wrong.

```bash
bin/review                  # everything since the last reviewed commit
bin/review <a>..<b>         # a range
bin/review <commit-sha>     # one commit, without moving the mark
bin/review --uncommitted    # the working tree, before committing
```

## The mark

`REVIEWED`, at the repository root, records what has already been read: one line
per finished review, the reviewed-up-to commit first.

```
991e072  2026-08-13  release 4.1.15, the version in the field when this record began
7663e16  2026-09-04  991e072..7663e16
4283d0d  2026-09-04  7663e16..4283d0d
```

A bare `bin/review` starts from the last line, so nobody has to remember where
the previous read stopped. The mark moves only when a review ends at `HEAD` and
the reader exits cleanly — a single-commit or working-tree read is a re-read and
leaves it alone. Lines are append-only: correct a mistake by adding one.

## Naming the reader

The reviewing CLI is named by `REVIEW_AGENT`, in the untracked `.env` or in your
shell profile, so the repository carries no vendor name and the reader can be
swapped without editing anything:

```bash
REVIEW_AGENT=<your-review-cli>
```

Only that one key is read from `.env`. A CLI that reads a diff has no business
inheriting the database password.

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
