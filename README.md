# Instrument Interfacing Tool

A standalone Electron application that receives test results from laboratory instruments and stores them in a local database (SQLite and/or MySQL). It is designed to be **LIS-agnostic** — any Laboratory Information System can pick up results from the shared database.

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

## Building Locally

**Prerequisites:** [Node.js LTS](https://nodejs.org)

```bash
# Clone the repository
git clone https://github.com/deforay/vlsm-interfacing.git
cd vlsm-interfacing

# Install dependencies
npm install

# Run in development mode
npm start

# Build for production
npm run electron:build
```

The production build output will be in the `release/` directory.

## Getting Started

See the [User Guide](USER_GUIDE.md) for step-by-step setup instructions covering login, settings configuration, and using the console.
