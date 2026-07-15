ALTER TABLE orders ADD COLUMN ingestion_id TEXT DEFAULT NULL;

-- Existing queued rows also need a stable identity before their next retry.
UPDATE orders SET ingestion_id = lower(hex(randomblob(16))) WHERE ingestion_id IS NULL;

CREATE UNIQUE INDEX idx_orders_ingestion_id ON orders (ingestion_id);
