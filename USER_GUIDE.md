# Instrument Interfacing Tool - User Guide

This guide walks you through setting up and using the Instrument Interfacing Tool for the first time.

## 1. Login

When you launch the application, you will see the login screen.

- **Login ID:** `admin`
- **Password:** `admin`

Click **Sign in** to continue.

> On first login, you will be taken directly to the Settings page to configure the tool.

---

## 2. Settings

The Settings page is organized into sections accessible via the sidebar on the left.

### 2.1 System Configuration

| Field | Description |
|-------|-------------|
| **Testing Lab Code/ID** | A unique identifier for your lab (e.g., `LAB001`) |
| **Testing Lab Name** | Your laboratory's name |
| **Auto-connect on startup** | When set to `Yes`, the app skips the login screen and automatically connects all instruments on startup. When set to `No`, you will see the login screen each time and need to connect instruments manually. |

The **SQLite Database Path** is pre-configured and shows where results are stored locally.

### 2.2 MySQL Configuration *(Optional)*

If your LIS uses MySQL to pick up results, configure the connection here:

| Field | Description |
|-------|-------------|
| **MySQL Host** | Database server address (e.g., `127.0.0.1`) |
| **MySQL Port** | Database port (default: `3306`) |
| **Database Name** | Name of the interfacing database (e.g., `interfacing`) |
| **Database User** | MySQL username |
| **Database Password** | MySQL password |

Click **Test Connection** to verify the database is reachable before saving.

> If you skip MySQL configuration, results will only be stored in the local SQLite database.

### 2.3 Instruments Configuration

This is where you add the laboratory instruments that will connect to this tool.

Click **+ Add Instrument** and fill in the following for each instrument:

**Connection Settings:**

| Field | Description |
|-------|-------------|
| **Connection Mode** | `TCP Server` — the instrument connects to this tool. `TCP Client` — this tool connects to the instrument. |
| **Communication Protocol** | The protocol your instrument uses: `ASTM`, `ASTM (with checksum)`, or `HL7` |
| **IP Address** | The network address for the connection |
| **Port Number** | The port number for the connection (1–65535) |

**Instrument Details:**

| Field | Description |
|-------|-------------|
| **Analyzer Type** | Select the instrument model (e.g., Abbott m2000, Cepheid GeneXpert, Roche COBAS) |
| **Instrument Name/Code** | A name that identifies this instrument. This name is used by the LIS to map results. If LIS API is configured, you will see autocomplete suggestions. |
| **Display Order** | Controls the order instruments appear in the console |

> You can add multiple instruments. Each must have a unique name and a unique IP:Port combination.

### 2.4 LIS API Configuration *(Optional)*

If your LIS provides an API, you can configure it here to fetch instrument name suggestions. This helps ensure the instrument names in this tool match what the LIS expects.

| Field | Description |
|-------|-------------|
| **Base URL** | The LIS API base URL (e.g., `https://lis.example.com`) |
| **Auth Type** | `None`, `Bearer Token`, `Basic Auth`, or `API Key` — depending on what your LIS requires |
| **Fetch Instruments Endpoint** | The API path to fetch instrument names (e.g., `/api/v1.1/instruments?labId=XYZ`) |

Click **Fetch Instruments** to test the connection and retrieve instrument names.

> This is optional. You can always type instrument names manually.

### Saving

Click **Save Settings** when you are done. The tool will apply your configuration and take you to the Console.

---

## 3. Console

The Console is where you monitor instrument connections and view incoming results.

### 3.1 Instrument Connections

Each configured instrument appears as a tab at the top. For each instrument you can see:

- **Connection status** — a green checkmark (Connected) or red cross (Disconnected)
- **Connection details** — machine type, connection mode, address, and protocol
- **Connection logs** — live log of communication with the instrument

**To connect an instrument:**

- If **Auto-connect** is set to `Yes` in settings, the app will skip the login screen and automatically attempt to connect all configured instruments on startup
- If **Auto-connect** is set to `No`, you will need to log in first, then click the **Connect** button on each instrument's tab
- Wait for the status to show **Connected** before expecting results

> Results can only be received from an instrument when it shows as **Connected**.

### 3.2 Received Results

Below the instrument tabs, you will find the **Received Results** table showing all results received from instruments:

| Column | Description |
|--------|-------------|
| **Instrument** | Which instrument sent the result |
| **Sample ID** | The sample/order identifier |
| **Result** | The test result value |
| **Unit** | The unit of measurement |
| **Test Type** | Type of test performed |
| **Tested By** | Operator who ran the test |
| **Tested On** | When the test was performed |
| **Received On** | When this tool received the result |
| **Sync Status** | Whether the result has been synced to the LIS: `Pending`, `Synced`, or `Failed` |

You can:
- **Search** results by instrument, Sample ID, or test type
- **Re-sync** selected results that failed to sync
- **Refresh** the results list

### 3.3 Quick Stats

At the bottom of the console, two timestamps show:
- **Last Results Synced to LIS** — when results were last picked up by the LIS
- **Last Result From Instrument** — when the last result was received from any instrument

---

## Quick Reference

| Action | Where |
|--------|-------|
| Change settings | Console → **Settings** button (top right) |
| View raw data | Console → **View Raw Data** button (bottom left) |
| View dashboard | Console → **Dashboard** button (top right) |
| Export settings | Settings → **Export Settings** (for backup or sharing) |
| Import settings | Settings → **Import Settings** (to restore or replicate setup) |
