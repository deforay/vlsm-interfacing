# Usage statistics

Usage statistics are stored as an additive, PII-free operational event journal. They do not replace
the existing `orders`, `raw_data`, or `app_log` contracts.

## Persistence flow

1. The application commits each event to SQLite `telemetry_events`.
2. Instrument and result processing continues regardless of MySQL availability.
3. When MySQL is configured, events are replicated to MySQL `telemetry_events`.
4. Rows with `mysql_inserted = 0` remain queued in SQLite and are retried.
5. `event_id` is stable across both databases and makes retries idempotent.

A trigger adds each `test.processed` event to `usage_statistics_daily` in the
same transaction: one row per day, laboratory, installation, instrument,
machine type and test type, with total, successful and failed test counts. Daily rows are replicated to MySQL
the same way.

## What leaves the machine

Usage statistics leave the machine by two routes.

- **MySQL replication.** When MySQL is configured, both tables are copied there
  with every column, including `lab_id` and `source_installation_id`. That
  happens wherever the MySQL server runs.
- **Upload to InteLIS.** This happens only when the installation is
  [connected to InteLIS](../guide/settings.md#connecting-to-intelis) and the
  server's connection profile accepts usage statistics. Each request is a
  `POST` with the installation's bearer credential.

| Endpoint | Body | Fields of each item |
|----------|------|---------------------|
| `<InteLIS URL>/api/v1/interface/activity` | `{"events": [...]}` | `event_id`, `event_type`, `event_category`, `occurred_at`, `instrument_id`, `machine_type`, `protocol`, `connection_mode`, `test_type`, `outcome`, `failure_code`, `event_count`, `app_version` |
| `<InteLIS URL>/api/v1/interface/usage-statistics` | `{"summaries": [...]}` | `aggregate_id`, `activity_date`, `instrument_id`, `machine_type`, `test_type`, `total_tests`, `successful_tests`, `failed_tests`, `first_test_at`, `last_test_at`, `revision` |

Neither request carries `lab_id` or `source_installation_id`. InteLIS
identifies the installation by its credential. An acknowledged event gets
`remote_uploaded_at`. An acknowledged daily row records the sent revision in
`remote_uploaded_revision`, so a row that changes after it was sent is sent
again. Nothing sets `remote_batch_id`. A failed request is retried after 30
seconds, and each further failure doubles the wait, up to 15 minutes.

## Data contract

The table contains application usage, instrument lifecycle, test counts, and
operational failure categories. The event types are `application.started`,
`instrument.connection_attempted`, `instrument.connected`,
`instrument.connection_failed`, `test.processed`, `test.processing_failed`,
`result.delivery_completed` and `result.delivery_failed`. Each event also
records the `lab_id` (**Testing Lab Code/ID**) and the
`source_installation_id`. The table excludes sample and order IDs,
result values, raw messages, operator details, and free-form error messages.

Useful MySQL summaries include:

```sql
SELECT event_type, outcome, SUM(event_count) AS total
FROM telemetry_events
WHERE occurred_at >= CURRENT_DATE - INTERVAL 30 DAY
GROUP BY event_type, outcome;
```

```sql
SELECT instrument_id, machine_type, test_type, outcome, SUM(event_count) AS total
FROM telemetry_events
WHERE event_type = 'test.processed'
GROUP BY instrument_id, machine_type, test_type, outcome;
```

Existing LIS integrations continue reading test results from MySQL `orders`.
No existing table or column has been removed or repurposed.
