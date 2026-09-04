# Analyzers as they behave

Taken from captures of live laboratories, not from documentation. Each is
reproduced as a fixture under `src/app/testing/fixtures/captured/` and replayed
by `src/app/services/analyzer-captures.spec.ts`, so a change that alters what a
real analyzer's message stores fails there first.

## Cepheid GeneXpert — ASTM

- The `H` record declares its delimiters as `@^\` rather than `\^&`.
- One message per test, each in its own session.
- Frames are filled to 240 bytes and **cut wherever that falls**, so records
  split across `<ETB>` continuation frames, routinely mid-field.
- `O.3` is whatever the operator typed as the sample ID — sometimes a patient
  name, sometimes a free-text note.
- `R.1` carries the assay result with a trailing component separator:
  `NOT DETECTED^`, `DETECTED^`, `ERROR^`, `INVALID^`. For viral load the number
  is in the **second** component (`^1234.56`), `R.5` is the unit and `R.6` the
  reportable range.
- A `C` record explains an error: `Error^code^title^description^timestamp`.
- `O.26` is `F` even for a run that errored, so the result text and the comment
  are what say the run failed — not the status field.

### Locale changes everything except the shape

A GeneXpert 6.5 running in French sends `NON DÉTECTÉ`, `DÉTECTÉ`, `ERREUR`,
`PAS DE RÉSULTAT`, with `RÉUSSITE`/`NÉG`/`POS` on control records, and writes
every number with a decimal comma — in the result, the reportable range, and
every Ct and endpoint. Its error comments are French and contain a no-break
space. A viral load can come back `DÉTECTÉ` with **no number at all**, flagged
`<` in `R.7`, meaning detected below the reportable range — so the unit alone
does not tell you whether there is a number to read.

## Abbott m2000 — ASTM

- A whole run in one session: one `H`, then `P`/`O`/`R` per specimen.
- `O.4` is `specimenId^run^well`; only the first component is the identifier.
- Results include `Not detected`, `< 40`, and plain counts.
- A failed order arrives with **no `R` record at all** and `O.26` = `X`. The
  explanation is in a `C` record, e.g. `4442 : Internal control cycle number is
  too high.`
- Empty sessions — `<ENQ>` then `<EOT>` with nothing between — are normal
  between runs, as is a stray NUL byte.

## Abbott Alinity m — HL7

- `SPM.3` carries the specimen identifier.
- `OBX.6` is `^Copies/mL`: the identifier component empty, the text filled.
- Not-detected and below-range outcomes come through as text rather than
  numbers.

## Roche cobas 4800, 5800, 6800/8800 — HL7

- 6800/8800 report a quantitative result on the second observation, with a
  `&ROCHE` suffix to strip, and `OBX.6` as `copies/mL^^UCUM`.
- A UCUM unit can carry a power of ten: `10*-1.{Copies}/mL` with a mantissa. It
  is stored as sent — reading it is the LIS's job.
- cobas 4800 reports quantitative results as text such as `3.26E+05 cp/mL`.
- Instrument errors and flags arrive as text and are stored as `Failed` with the
  detail kept in the notes.

## The generic choices

`Other ASTM (with checksum)`, `Other ASTM (without checksum)` and `Other HL7`
parse the standards without model-specific field mapping. An analyzer that is in
the list above will store results under a generic choice, but fields that depend
on knowing the dialect — which component holds the specimen ID, what an empty
result field means — may come through empty.

## Adding an analyzer

1. Capture what it actually sends. The stored raw transmissions are the source;
   a vendor's document is a description of them.
2. Anonymise: identifiers, operator names, serial numbers, dates. Record
   layouts, value formats and framing stay exactly as transmitted.
3. Add it as a fixture under `src/app/testing/fixtures/captured/`, with a header
   comment saying what the capture showed.
4. Replay it in `analyzer-captures.spec.ts`, asserting the stored rows.
5. Only then write the mapping.
