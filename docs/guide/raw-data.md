# Raw data, and recovering results from it

Every transmission an analyzer sends is stored exactly as it arrived, before
the tool tries to understand it. **Console → View Raw Data** shows them: which
instrument, when, and the transmission itself.

That record exists for one reason. If the tool ever read a transmission wrongly,
the analyzer does not have to send it again — the result can be worked out from
what was stored, once the reading is fixed.

## When you would use it

- **A version of the tool stored results wrongly, and a newer one fixes it.**
  This is the usual case, and the one below.
- **A result did not appear at all** although the console log shows the
  transmission arriving.
- **Someone needs to see exactly what the analyzer said** — the raw record is
  the evidence, not the row in the results table.

## Reprocessing

1. Upgrade first. Reprocessing reads transmissions with the version you are
   running now, so on an old version it reproduces the same wrong reading.
2. Open **Console → View Raw Data**.
3. Find the transmissions. The search box matches the instrument, the date, and
   the content of the transmission itself, so a sample ID finds the
   transmission that carried it.
4. Tick them, and press **Reprocess Selected**. A single transmission can also
   be reprocessed from the button on its row.
5. Progress is shown as it goes, with a count of what succeeded and what failed.

!!! warning "Reprocessing adds results. It does not correct the ones already there."

    Each reprocessed transmission is stored as a **new** result. The earlier,
    wrong result stays exactly where it is, and both then appear in the results
    table under the same sample ID — one wrong, one right.

    The new results are also queued for the LIS as new results, which for a
    sample the LIS has already taken may not be what anyone wants.

    So before reprocessing a run of any size, agree with whoever runs the LIS
    what should happen to the results it has already accepted. On a handful of
    samples this is a conversation. On several hundred it is a plan.

## Recovering from the framing defect in versions before 4.2.0

Analyzers that split records across frames — the Cepheid GeneXpert in
particular, which fills 240-byte frames and cuts records wherever that falls —
were read incorrectly by versions before 4.2.0. Depending on where the cut
landed, a result was stored either **empty** or **truncated**, sometimes with
stray characters where the unit should be, such as `co␗E4` instead of
`copies/mL`.

One laboratory had 97 of 136 results stored empty this way, and synced to their
LIS as empty, without anything appearing to go wrong.

Nothing was lost. The transmissions were stored intact, and every one of those
136 results can be read correctly by the current version. To recover:

1. **Upgrade to 4.2.0 or later.**
2. **Check a single transmission first.** Reprocess one, and compare the new
   result against the analyzer's own printout for that sample. It should match
   exactly, including how the number is written.
3. **Agree the plan with your LIS** — see the warning above. The affected
   samples already went across as blank or truncated, and correcting them is
   the LIS's business as much as this tool's.
4. **Then reprocess the rest**, in batches you can check.

!!! tip "How to tell whether you are affected"

    Look in the results table for results that are blank, or that end in
    stray characters, or units that read like `co` or `cop` rather than
    `copies/mL`. Sort by sample ID: an affected run tends to show a stretch of
    them together, because the analyzer was behaving consistently.
