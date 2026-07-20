# Local Usage Statistics Storage

Usage statistics are stored as an additive, PII-free operational event journal. They do not replace
the existing `orders`, `raw_data`, or `app_log` contracts.

## Persistence flow

1. The application commits each event to SQLite `telemetry_events`.
2. Instrument and result processing continues regardless of MySQL availability.
3. When MySQL is configured, events are replicated to MySQL `telemetry_events`.
4. Rows with `mysql_inserted = 0` remain queued in SQLite and are retried.
5. `event_id` is stable across both databases and makes retries idempotent.

The future remote reporting uploader will use `remote_uploaded_at` and
`remote_batch_id` independently of MySQL replication.

## Data contract

The table contains application usage, instrument lifecycle, test counts, and
operational failure categories. It intentionally excludes sample and order IDs,
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

Existing LIS integrations should continue reading test results from MySQL
`orders`; no existing table or column has been removed or repurposed.
