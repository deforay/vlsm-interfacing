ALTER TABLE `orders` ADD COLUMN `ingestion_id` VARCHAR(36) NULL;

CREATE UNIQUE INDEX `idx_orders_ingestion_id` ON `orders` (`ingestion_id`);
