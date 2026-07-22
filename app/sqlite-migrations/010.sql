ALTER TABLE `telemetry_events` ADD COLUMN `source_installation_id` TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS `usage_statistics_daily` (
  `id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `aggregate_id` TEXT NOT NULL,
  `activity_date` date NOT NULL,
  `source_installation_id` TEXT NOT NULL,
  `lab_id` TEXT NOT NULL DEFAULT '',
  `instrument_id` TEXT NOT NULL DEFAULT '',
  `machine_type` TEXT NOT NULL DEFAULT '',
  `test_type` TEXT NOT NULL DEFAULT '',
  `total_tests` INTEGER NOT NULL DEFAULT 0,
  `successful_tests` INTEGER NOT NULL DEFAULT 0,
  `failed_tests` INTEGER NOT NULL DEFAULT 0,
  `first_test_at` datetime NOT NULL,
  `last_test_at` datetime NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `mysql_synced_revision` INTEGER NOT NULL DEFAULT 0,
  `remote_uploaded_revision` INTEGER NOT NULL DEFAULT 0,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX `idx_usage_statistics_daily_aggregate_id`
  ON `usage_statistics_daily` (`aggregate_id`);
CREATE UNIQUE INDEX `idx_usage_statistics_daily_dimensions`
  ON `usage_statistics_daily` (`activity_date`, `source_installation_id`, `lab_id`, `instrument_id`, `machine_type`, `test_type`);
CREATE INDEX `idx_usage_statistics_daily_mysql_pending`
  ON `usage_statistics_daily` (`mysql_synced_revision`, `revision`);
CREATE INDEX `idx_usage_statistics_daily_remote_pending`
  ON `usage_statistics_daily` (`remote_uploaded_revision`, `revision`);

-- WHY: rebuilding existing events makes upgrades complete without replaying or
-- changing the immutable event journal.
INSERT OR IGNORE INTO `usage_statistics_daily` (
  `aggregate_id`, `activity_date`, `source_installation_id`, `lab_id`, `instrument_id`, `machine_type`, `test_type`,
  `total_tests`, `successful_tests`, `failed_tests`, `first_test_at`, `last_test_at`
)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  date(`occurred_at`),
  COALESCE(`source_installation_id`, ''),
  COALESCE(`lab_id`, ''),
  COALESCE(`instrument_id`, ''),
  COALESCE(`machine_type`, ''),
  COALESCE(`test_type`, ''),
  SUM(`event_count`),
  SUM(CASE WHEN lower(`outcome`) = 'failed' THEN 0 ELSE `event_count` END),
  SUM(CASE WHEN lower(`outcome`) = 'failed' THEN `event_count` ELSE 0 END),
  MIN(`occurred_at`),
  MAX(`occurred_at`)
FROM `telemetry_events`
WHERE `event_type` = 'test.processed'
GROUP BY
  date(`occurred_at`),
  COALESCE(`source_installation_id`, ''),
  COALESCE(`lab_id`, ''),
  COALESCE(`instrument_id`, ''),
  COALESCE(`machine_type`, ''),
  COALESCE(`test_type`, '');

-- WHY: the summary and its source event must commit together. The unique event
-- ID prevents a replayed event from ever reaching this trigger twice.
CREATE TRIGGER IF NOT EXISTS `trg_usage_statistics_daily_after_test`
AFTER INSERT ON `telemetry_events`
WHEN NEW.`event_type` = 'test.processed'
BEGIN
  INSERT INTO `usage_statistics_daily` (
    `aggregate_id`, `activity_date`, `source_installation_id`, `lab_id`, `instrument_id`, `machine_type`, `test_type`,
    `total_tests`, `successful_tests`, `failed_tests`, `first_test_at`, `last_test_at`
  ) VALUES (
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-' ||
      substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
      lower(hex(randomblob(6))),
    date(NEW.`occurred_at`),
    COALESCE(NEW.`source_installation_id`, ''),
    COALESCE(NEW.`lab_id`, ''),
    COALESCE(NEW.`instrument_id`, ''),
    COALESCE(NEW.`machine_type`, ''),
    COALESCE(NEW.`test_type`, ''),
    NEW.`event_count`,
    CASE WHEN lower(NEW.`outcome`) = 'failed' THEN 0 ELSE NEW.`event_count` END,
    CASE WHEN lower(NEW.`outcome`) = 'failed' THEN NEW.`event_count` ELSE 0 END,
    NEW.`occurred_at`,
    NEW.`occurred_at`
  )
  ON CONFLICT (`activity_date`, `source_installation_id`, `lab_id`, `instrument_id`, `machine_type`, `test_type`)
  DO UPDATE SET
    `total_tests` = `total_tests` + excluded.`total_tests`,
    `successful_tests` = `successful_tests` + excluded.`successful_tests`,
    `failed_tests` = `failed_tests` + excluded.`failed_tests`,
    `first_test_at` = MIN(`first_test_at`, excluded.`first_test_at`),
    `last_test_at` = MAX(`last_test_at`, excluded.`last_test_at`),
    `revision` = `revision` + 1,
    `updated_at` = CURRENT_TIMESTAMP;
END;
