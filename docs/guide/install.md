# Installing

## Debian and Ubuntu

```bash
# The current release
curl -fsSL https://raw.githubusercontent.com/deforay/intelis-interfacing/master/scripts/install.sh | bash

# A specific release
curl -fsSL https://raw.githubusercontent.com/deforay/intelis-interfacing/master/scripts/install.sh | bash -s -- --tag v4.2.1
```

The script downloads the `.deb` for the machine's architecture from the GitHub
release, removes any older package it supersedes, installs it, and repairs
dependencies if `dpkg` leaves any unresolved.

!!! note "If sudo prompts for a password"

    A command reading from a pipe cannot answer a password prompt. Download
    first, then run:

    ```bash
    curl -fsSL https://raw.githubusercontent.com/deforay/intelis-interfacing/master/scripts/install.sh -o install.sh
    bash install.sh
    ```

## Windows

Download the installer for your architecture from the
[releases page](https://github.com/deforay/intelis-interfacing/releases) and run
it. A portable build is published alongside it for machines where you would
rather not install anything.

## macOS

There is no published macOS build. The application can be built from source on
a Mac — see [building and releasing](../technical/building.md) — but releases
carry Windows and Debian packages only.

## Upgrading

Install the newer version the same way you installed the current one. Your
settings, results, raw transmissions and backups are not part of the
application: they live in the machine's own data directory and are left alone.

## Being told about a new version

The console shows a line when a newer version has been published — the version
that is available, the version you are running, and a link to what changed.
Nothing is downloaded and nothing is installed: when to update a machine
standing between an analyzer and the laboratory system is the laboratory's
decision, not the software's.

**Not now** hides that particular version. The next release after it will say so
again.

The check asks GitHub, where the releases are published, a little after startup
and every few hours after that. A machine with no route to the internet simply
never sees the line — nothing is logged, nothing fails, and no part of the tool
waits on it. This is also why the check is not routed through your laboratory
information system: the tool is meant to work in front of any system, or none.

## Upgrading from vlsm-interfacing

The application was called **vlsm-interfacing** until version 4.2.1. Everything
carries over:

- **Your data stays exactly where it is.** The folder holding the settings, the
  results database, the raw transmissions and the backups is named
  independently of the application, so the rename does not move it and the tool
  opens with everything you had.
- **Windows replaces the old version** rather than installing beside it. You
  will not find two copies in the Start menu, and there is no risk of two copies
  competing for the same port.
- **Debian and Ubuntu**: the install script removes the `vlsm-interfacing`
  package before installing the new one. Removing a package does not touch your
  configuration directory, so nothing of yours is removed with it.

The only visible change is the name — in the Start menu, the applications menu,
and the installer file you downloaded.
