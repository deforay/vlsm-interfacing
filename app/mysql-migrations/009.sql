ALTER TABLE `telemetry_events`
  ADD COLUMN `source_installation_id` VARCHAR(128) DEFAULT NULL AFTER `lab_id`,
  ADD KEY `idx_telemetry_events_source_time` (`source_installation_id`, `occurred_at`);

CREATE TABLE IF NOT EXISTS `usage_statistics_daily` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `aggregate_id` CHAR(36) NOT NULL,
  `activity_date` DATE NOT NULL,
  `source_installation_id` VARCHAR(128) NOT NULL,
  `lab_id` VARCHAR(128) NOT NULL DEFAULT '',
  `instrument_id` VARCHAR(128) NOT NULL DEFAULT '',
  `machine_type` VARCHAR(128) NOT NULL DEFAULT '',
  `test_type` VARCHAR(128) NOT NULL DEFAULT '',
  `total_tests` INT UNSIGNED NOT NULL DEFAULT 0,
  `successful_tests` INT UNSIGNED NOT NULL DEFAULT 0,
  `failed_tests` INT UNSIGNED NOT NULL DEFAULT 0,
  `first_test_at` DATETIME NOT NULL,
  `last_test_at` DATETIME NOT NULL,
  `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `remote_uploaded_revision` INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_usage_statistics_daily_aggregate_id` (`aggregate_id`),
  KEY `idx_usage_statistics_daily_activity` (`activity_date`, `instrument_id`),
  KEY `idx_usage_statistics_daily_remote_pending` (`remote_uploaded_revision`, `revision`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
