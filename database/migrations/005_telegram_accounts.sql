-- =========================================================
-- TELEGRAM ACCOUNTS (Mini App identity)
-- =========================================================

CREATE TABLE telegram_accounts (
    telegram_user_id BIGINT PRIMARY KEY,

    username VARCHAR(64),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    language_code VARCHAR(16),
    photo_url TEXT,

    member_id BIGINT UNIQUE
        REFERENCES cancheros_members(id)
        ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX telegram_accounts_member_id_idx
    ON telegram_accounts (member_id)
    WHERE member_id IS NOT NULL;
