ALTER TABLE app_log ADD COLUMN category TEXT NOT NULL DEFAULT 'operational';

CREATE INDEX idx_app_log_added_on ON app_log (added_on);
