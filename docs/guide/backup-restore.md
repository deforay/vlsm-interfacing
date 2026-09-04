# Backup and restore

**Settings → Backup & Restore.**

## Automatic backup

The tool keeps a copy of your settings whenever they change, so that a mistaken
change, a failed disk or a reinstall does not mean configuring every instrument
again. It is on by default, checks once a day, and keeps the last 10 copies.

**A backup is written only when something actually changed.** Settings normally
change a few times a year, so a daily check does not mean a file a day: the 10
copies kept are the last 10 *different* configurations. That is what lets you go
back to how things were months ago rather than only to last week. **Check for
changes** sets how soon a change is captured, not how many files you end up
with.

Older copies are thinned rather than deleted outright. Beyond the recent ones,
the tool keeps one backup per week for the last three months and one per month
for the last two years. This matters on a busy day: change settings ten times
while setting up an instrument and those ten changes do not push out the stable
configuration from last month that you might actually want back.

**Back Up Now** does the same on demand, and tells you when there is nothing new
to save. **Open Backup Folder** shows where the copies are — one folder, named
by date and time, newest last.

!!! note "What a backup contains"

    Settings only. Test results and raw analyzer data are not included.
    Automatic backups never contain passwords, which is what makes them safe to
    leave on the machine — after restoring one you re-enter the database
    password and any LIS credentials.

## Exporting settings

**Export Settings** asks what the file should contain:

| Choice | Contains | Use it for |
|--------|----------|------------|
| **Settings Only** | Instruments, database host, LIS configuration. No passwords. | Sharing a setup, or a copy you may email or put on a shared drive |
| **Settings and Credentials** | The above, plus the database password and LIS credentials, encrypted with a passphrase you choose | A complete backup you can restore without re-entering anything |

!!! danger "A passphrase cannot be recovered"

    An encrypted export cannot be opened without its passphrase — not by you,
    not by us. Store it somewhere safe and separate from the file itself.

## Importing settings

**Import Settings** accepts any file this tool has produced, including from
older versions. If the file is encrypted you are asked for its passphrase. The
settings are reloaded once the import succeeds.

!!! info "A restored copy is a separate installation"

    Importing never copies the original machine's identity. A machine restored
    from another machine's export registers as its own installation, so results
    are never counted twice.
