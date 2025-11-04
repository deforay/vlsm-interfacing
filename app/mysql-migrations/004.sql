ALTER TABLE `app_log`
ADD COLUMN `log_type` VARCHAR(20) NULL,
ADD COLUMN `log_message` TEXT NULL,
ADD COLUMN `instrument_id` VARCHAR(255) NULL;
