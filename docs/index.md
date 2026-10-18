# InteLIS Interfacing

A laboratory analyzer finishes a test and reports the result down a cable. A
laboratory information system needs that result against the right sample. This
tool sits between the two: it listens to the analyzer, understands what it
said, and writes it where the LIS can pick it up.

It is deliberately **LIS-agnostic**. Results land in a local SQLite database and,
if you configure one, a MySQL database that any information system can read.
Nothing about the tool assumes a particular LIS.

<div class="grid cards" markdown>

- :material-book-open-variant: **[User guide](guide/index.md)**

    Install it, configure an instrument, watch results arrive, and know what to
    do when they do not.

- :material-tools: **[Technical guide](technical/index.md)**

    What the analyzers actually send, how a result becomes a row, and the rules
    a change to this code is held to.

</div>

## Common tasks

| To do this | Go to |
|------------|-------|
| Install or upgrade | [Install](guide/install.md) |
| Add an instrument | [Settings: Instruments](guide/settings.md#instruments) |
| Change how a result is stored for the LIS | [Settings: Result rules](guide/settings.md#result-rules) |
| Fix an analyzer that will not connect | [Troubleshooting](guide/troubleshooting.md#the-analyzer-will-not-connect) |
| Find out why results are not reaching the LIS | [Troubleshooting](guide/troubleshooting.md#results-are-not-reaching-the-lis) |
| Read results again from the raw data | [Raw data: Reprocessing](guide/raw-data.md#reprocessing) |
| Move settings to another machine | [Backup and restore](guide/backup-restore.md#exporting-settings) |
| Find the log files | [Troubleshooting](guide/troubleshooting.md#where-the-log-files-are) |
| Receive results over HTTP | [Result webhook](technical/result-webhook.md) |

## What it does

1. Analyzers connect over TCP, or the tool connects to them: Abbott m2000 and
   Alinity m, Cepheid GeneXpert, Roche cobas 4800, 5800, 6800/8800 and Taqman,
   or anything that speaks the same protocols.
2. The tool reads their transmissions: ASTM E1394 records inside E1381 frames,
   with or without checksums, or HL7 v2 inside MLLP blocks.
3. Each result is stored locally, exactly as the analyzer reported it, together
   with the raw transmission it came from. A laboratory can add
   [result rules](guide/settings.md#result-rules) to change the value its LIS
   receives. The value as sent is still kept.
4. The LIS reads the results from MySQL, or the tool pushes them to an API, and
   the sync state of each result is visible in the console.
5. Optionally, every result is also forwarded as JSON to any HTTP receiver,
   such as an integration engine. See
   [result forwarding](guide/settings.md#result-forwarding).

## What it will not do

It does not interpret a result unless a laboratory sets a result rule. A number the analyzer wrote with a decimal
comma is stored with a decimal comma. `Target Not Detected` is stored as
`Target Not Detected`. Deciding what a value means is the laboratory's and the
LIS's work, and a tool that quietly rounded, rescaled or translated on the way
past would be a tool nobody could check.

!!! info "Previously vlsm-interfacing"

    The application was renamed. An existing installation upgrades in place and
    keeps its settings, results, raw transmissions and backups exactly where
    they were. See [Upgrading from vlsm-interfacing](guide/install.md#upgrading-from-vlsm-interfacing).
