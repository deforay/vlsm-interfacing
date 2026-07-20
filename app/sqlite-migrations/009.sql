ALTER TABLE orders ADD COLUMN mysql_status_synced INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_orders_mysql_status_pending
  ON orders (mysql_status_synced, id);
