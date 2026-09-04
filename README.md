# InteLIS Interfacing

![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue)

A standalone Electron application that receives test results from laboratory instruments and stores them in a local database (SQLite and/or MySQL). It is designed to be **LIS-agnostic** — any Laboratory Information System can pick up results from the shared database.

> Previously released as **vlsm-interfacing**. Upgrading in place keeps everything: the same settings, database, results and backups, in the same folder as before. On Debian and Ubuntu the installer removes the old package for you; on Windows the installer replaces the old version rather than sitting beside it.

## How It Works

1. Laboratory instruments (e.g., Abbott m2000, Cepheid GeneXpert, Roche COBAS) connect to this tool over TCP
2. The tool receives results using standard protocols (ASTM or HL7)
3. Results are stored in a local SQLite database and optionally in a MySQL database
4. The LIS picks up results from MySQL and updates its test requests independently

## Features

- Support for multiple instruments running simultaneously
- ASTM (with/without checksum) and HL7 communication protocols
- TCP Server and TCP Client connection modes
- Real-time connection monitoring and logging
- Auto-connect on startup with login bypass
- Results table with search, sort, and sync status tracking
- Optional LIS API integration for instrument name suggestions
- Import/Export settings for backup and replication across machines
- Dashboard with result statistics

## Install

```bash
# Install latest version
curl -fsSL https://raw.githubusercontent.com/deforay/intelis-interfacing/master/scripts/install.sh | bash

# Install a specific version
curl -fsSL https://raw.githubusercontent.com/deforay/intelis-interfacing/master/scripts/install.sh | bash -s -- --tag v4.0.3
```

## Getting Started

See the [User Guide](USER_GUIDE.md) for step-by-step setup instructions covering login, settings configuration, and using the console.

## Build From Source

For developers or anyone who wants to build the application locally from source.

**Prerequisites:** [Node.js LTS](https://nodejs.org)

```bash
# Clone the repository
git clone https://github.com/deforay/intelis-interfacing.git
cd intelis-interfacing

# Install dependencies
npm install

# Run in development mode
npm start

# Build for production
npm run electron:build
```

The production build output will be in the `release/` directory.

## Verification

Run the local quality gate before submitting a change:

```bash
npm run verify
```

This checks lint rules, unit tests, the Electron main-process compilation, and
the optimized Angular production build. The same gate runs automatically for
pull requests and pushes to `master`.

### Electron safety invariants

`npm run verify` starts with `npm run check:safety`, which asserts the two facts
that keep this app's renderer safe. The renderer runs with `nodeIntegration`
enabled, so anything that executes as script there executes with full Node. That
is only safe because every value reaching the DOM goes through Angular's
escaping, and the window only ever loads the bundled `file://` build.

The check fails on changes that would break either — writing unescaped HTML
(`innerHTML`, `bypassSecurityTrust*`), loading remote content into a window,
opening a second web context, weakening `webPreferences`, or evaluating code at
runtime. Each finding explains what it protects and what to do instead.

If a finding is genuinely safe, say why on the line or the one above:

```ts
element.innerHTML = LEGAL_NOTICE; // electron-safety-ok: module constant, no input
```

A reason is required; a bare marker is still rejected.

For the same check as a pre-commit hook, run once per clone:

```bash
npm run install-hooks
```

CI is the enforcement — the hook is only faster feedback, and `--no-verify`
skips it.

### A second reader

Passing the gate is not the same as being read. `bin/review` hands a change to a
reviewing CLI with the brief in `docs/review-brief.md`, which says what this
codebase must never get wrong — a value altered on its way to the laboratory
system, a result attached to the wrong sample, framing left inside a field.

```bash
bin/review                  # everything since the last reviewed commit
bin/review <a>..<b>         # a range
bin/review --uncommitted    # the working tree, before committing
```

`REVIEWED` at the repository root records what has already been read, so a bare
run covers only what has landed since. Name the CLI once, in the untracked
`.env`, so the repository stays independent of it:

```bash
REVIEW_AGENT=<your-review-cli>
```

---

## Funding and partners

InteLIS Interfacing is developed with funding from the United States Government (USG). Over the years, the project has benefited from the support and collaboration of partners including the African Society for Laboratory Medicine (ASLM), the American Society for Microbiology (ASM), the African Field Epidemiology Network (AFENET), Emory University, and the Maryland Global Initiatives Corporation (MGIC), among others.

---

## License

InteLIS Interfacing is free and open-source software released under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

Read the full text in [LICENSE.md](LICENSE.md).

---

## Support

- Email [support@deforay.com](mailto:support@deforay.com)
- Website [deforay.com](https://deforay.com/)
