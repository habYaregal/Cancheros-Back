-- =========================================================
-- COMPETITION MONTHS (Premier League calendar months)
-- =========================================================

CREATE TABLE IF NOT EXISTS competition_months (
    id BIGSERIAL PRIMARY KEY,

    season_id BIGINT NOT NULL
        REFERENCES seasons(id)
        ON DELETE CASCADE,

    name VARCHAR(50) NOT NULL,

    month_number INTEGER NOT NULL,

    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (season_id, month_number)
);

ALTER TABLE gameweeks
    ADD COLUMN IF NOT EXISTS competition_month_id BIGINT
        REFERENCES competition_months(id)
        ON DELETE SET NULL;


-- =========================================================
-- H2H ROUNDS / MATCHES
-- =========================================================

CREATE TABLE IF NOT EXISTS h2h_rounds (
    id BIGSERIAL PRIMARY KEY,

    cancheros_id BIGINT NOT NULL
        REFERENCES cancheros(id)
        ON DELETE CASCADE,

    gameweek_id BIGINT NOT NULL
        REFERENCES gameweeks(id)
        ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (cancheros_id, gameweek_id)
);

CREATE TABLE IF NOT EXISTS h2h_matches (
    id BIGSERIAL PRIMARY KEY,

    round_id BIGINT NOT NULL
        REFERENCES h2h_rounds(id)
        ON DELETE CASCADE,

    player_one_id BIGINT
        REFERENCES cancheros_members(id)
        ON DELETE RESTRICT,

    player_two_id BIGINT
        REFERENCES cancheros_members(id)
        ON DELETE RESTRICT,

    player_one_score INTEGER,
    player_two_score INTEGER,

    player_one_points NUMERIC NOT NULL DEFAULT 0,
    player_two_points NUMERIC NOT NULL DEFAULT 0,

    winner_member_id BIGINT
        REFERENCES cancheros_members(id)
        ON DELETE SET NULL,

    is_bye BOOLEAN NOT NULL DEFAULT false,
    completed BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_h2h_matches_round_id
    ON h2h_matches (round_id);

CREATE INDEX IF NOT EXISTS idx_h2h_matches_players
    ON h2h_matches (player_one_id, player_two_id);
