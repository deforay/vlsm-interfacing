ALTER TABLE app_log ADD COLUMN log_type TEXT;

ALTER TABLE app_log ADD COLUMN log_message TEXT;

ALTER TABLE app_log ADD COLUMN instrument_id TEXT;

-- Add mysql_inserted column to raw_data
ALTER TABLE raw_data ADD COLUMN mysql_inserted INTEGER DEFAULT 0;

-- Add mysql_inserted column to app_log
ALTER TABLE app_log ADD COLUMN mysql_inserted INTEGER DEFAULT 0;

