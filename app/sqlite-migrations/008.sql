CREATE TABLE IF NOT EXISTS `telemetry_events` (
  `id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `event_id` TEXT NOT NULL,
  `event_type` TEXT NOT NULL,
  `event_category` TEXT NOT NULL,
  `occurred_at` datetime NOT NULL,
  `lab_id` TEXT DEFAULT NULL,
  `instrument_id` TEXT DEFAULT NULL,
  `machine_type` TEXT DEFAULT NULL,
  `protocol` TEXT DEFAULT NULL,
  `connection_mode` TEXT DEFAULT NULL,
  `test_type` TEXT DEFAULT NULL,
  `outcome` TEXT NOT NULL DEFAULT 'success',
  `failure_code` TEXT DEFAULT NULL,
  `event_count` INTEGER NOT NULL DEFAULT 1,
  `app_version` TEXT DEFAULT NULL,
  `mysql_inserted` INTEGER NOT NULL DEFAULT 0,
  `remote_uploaded_at` datetime DEFAULT NULL,
  `remote_batch_id` TEXT DEFAULT NULL,
  `added_on` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX `idx_telemetry_events_event_id` ON `telemetry_events` (`event_id`);
CREATE INDEX `idx_telemetry_events_occurred_at` ON `telemetry_events` (`occurred_at`);
CREATE INDEX `idx_telemetry_events_type_time` ON `telemetry_events` (`event_type`, `occurred_at`);
CREATE INDEX `idx_telemetry_events_instrument_time` ON `telemetry_events` (`instrument_id`, `occurred_at`);
CREATE INDEX `idx_telemetry_events_mysql_pending` ON `telemetry_events` (`mysql_inserted`, `id`);
CREATE INDEX `idx_telemetry_events_remote_pending` ON `telemetry_events` (`remote_uploaded_at`, `id`);
