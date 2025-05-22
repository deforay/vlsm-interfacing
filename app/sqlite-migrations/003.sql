-- SQLite migration script

-- Add instrument_id column to raw_data table
ALTER TABLE raw_data ADD COLUMN instrument_id VARCHAR(128);

-- Update existing records to set instrument_id equal to machine
UPDATE raw_data SET instrument_id = machine WHERE instrument_id IS NULL;

-- Add an index for better query performance
CREATE INDEX idx_raw_data_instrument_id ON raw_data (instrument_id);
