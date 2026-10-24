BEGIN;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nickname text NOT NULL, avatar_url text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_identities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 provider text NOT NULL, provider_app_id text NOT NULL DEFAULT '', provider_subject text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider, provider_app_id, provider_subject)
);
CREATE INDEX ON user_identities(user_id);
CREATE TABLE drinks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brand_name text NOT NULL, name text NOT NULL, category text NOT NULL,
 flavor_tags text[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE drink_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 drink_id uuid REFERENCES drinks ON DELETE SET NULL,
 brand_name_snapshot text NOT NULL, drink_name_snapshot text NOT NULL,
 sweetness_label text, sweetness_level smallint CHECK(sweetness_level BETWEEN 0 AND 5),
 ice_label text, ice_level text CHECK(ice_level IN ('regular','less','none','room','warm','hot')),
 size_label text, toppings jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(toppings) = 'array'),
 price_paid numeric(10,2) CHECK(price_paid >= 0), rating smallint CHECK(rating BETWEEN 1 AND 5),
 taste_tags text[] NOT NULL DEFAULT '{}', note text,
 consumed_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON drink_records(user_id, consumed_at DESC);
CREATE INDEX ON drink_records(drink_id);
CREATE TABLE user_preferences (
 user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
 preferred_categories text[] NOT NULL DEFAULT '{}', preferred_flavors text[] NOT NULL DEFAULT '{}', avoided_ingredients text[] NOT NULL DEFAULT '{}',
 default_sweetness_level smallint CHECK(default_sweetness_level BETWEEN 0 AND 5),
 default_ice_level text CHECK(default_ice_level IN ('regular','less','none','room','warm','hot')),
 budget_max numeric(10,2) CHECK(budget_max >= 0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE favorites (
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, drink_id uuid NOT NULL REFERENCES drinks ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, drink_id)
);
CREATE INDEX ON favorites(drink_id);
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER drinks_updated BEFORE UPDATE ON drinks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER records_updated BEFORE UPDATE ON drink_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER preferences_updated BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();
COMMIT;
