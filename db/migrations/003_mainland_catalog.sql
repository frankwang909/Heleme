ALTER TABLE drinks
 ADD COLUMN IF NOT EXISTS reference_price numeric(10,2) CHECK(reference_price > 0),
 ADD COLUMN IF NOT EXISTS source_label text,
 ADD COLUMN IF NOT EXISTS price_kind text NOT NULL DEFAULT 'unknown' CHECK(price_kind IN ('unknown','third_party_reference','store_verified')),
 ADD COLUMN IF NOT EXISTS price_city text,
 ADD COLUMN IF NOT EXISTS price_store text,
 ADD COLUMN IF NOT EXISTS price_source_url text,
 ADD COLUMN IF NOT EXISTS price_checked_at timestamptz;
