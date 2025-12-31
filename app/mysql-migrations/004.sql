ALTER TABLE `app_log` ADD COLUMN `log_type` VARCHAR(20) NULL;

ALTER TABLE `app_log` ADD COLUMN `log_message` TEXT NULL;

ALTER TABLE `app_log` ADD COLUMN `instrument_id` VARCHAR(255) NULL;
