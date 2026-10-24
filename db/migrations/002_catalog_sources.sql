ALTER TABLE drinks
 ADD COLUMN IF NOT EXISTS source_key text,
 ADD COLUMN IF NOT EXISTS source_url text,
 ADD COLUMN IF NOT EXISTS source_region text,
 ADD COLUMN IF NOT EXISTS source_checked_at timestamptz,
 ADD COLUMN IF NOT EXISTS source_category text,
 ADD COLUMN IF NOT EXISTS price numeric(10,2) CHECK (price >= 0),
 ADD COLUMN IF NOT EXISTS ingredients text[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS drinks_source_key ON drinks(source_key);
UPDATE drinks SET is_demo = true
 WHERE id BETWEEN '00000000-0000-4000-8000-000000000010'::uuid AND '00000000-0000-4000-8000-000000000017'::uuid;
