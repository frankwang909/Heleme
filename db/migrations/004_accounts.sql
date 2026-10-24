CREATE TABLE user_accounts (
 user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
 username text NOT NULL UNIQUE CHECK(username = lower(username) AND username ~ '^[a-z0-9_]{3,32}$'),
 password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz
);
CREATE TABLE auth_sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES user_accounts(user_id) ON DELETE CASCADE,
 csrf_token text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX ON auth_sessions(user_id);
CREATE INDEX ON auth_sessions(expires_at);
CREATE TABLE auth_rate_limits (
 key_hash text PRIMARY KEY, window_start timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL
);
