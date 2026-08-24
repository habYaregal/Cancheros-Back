-- =========================================================
-- SEASONS
-- =========================================================

CREATE TABLE seasons (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(20) NOT NULL UNIQUE,

    start_date DATE,
    end_date DATE,

    is_current BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- GAMEWEEKS
-- =========================================================

CREATE TABLE gameweeks (
    id BIGSERIAL PRIMARY KEY,

    season_id BIGINT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,

    fpl_id INTEGER NOT NULL,

    name VARCHAR(50) NOT NULL,

    deadline_time TIMESTAMPTZ,

    finished BOOLEAN NOT NULL DEFAULT false,
    is_previous BOOLEAN NOT NULL DEFAULT false,
    is_current BOOLEAN NOT NULL DEFAULT false,
    is_next BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (season_id, fpl_id)
);


-- =========================================================
-- FPL TEAMS / CLUBS
-- =========================================================

CREATE TABLE fpl_teams (
    id BIGSERIAL PRIMARY KEY,

    season_id BIGINT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,

    fpl_id INTEGER NOT NULL,

    name VARCHAR(100) NOT NULL,
    short_name VARCHAR(10) NOT NULL,
    code INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (season_id, fpl_id)
);


-- =========================================================
-- FPL PLAYERS
-- =========================================================

CREATE TABLE fpl_players (
    id BIGSERIAL PRIMARY KEY,

    season_id BIGINT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,

    fpl_id INTEGER NOT NULL,

    team_id BIGINT REFERENCES fpl_teams(id) ON DELETE SET NULL,

    first_name VARCHAR(100),
    second_name VARCHAR(100),
    web_name VARCHAR(100),

    position INTEGER,

    price INTEGER,

    status VARCHAR(10),

    photo VARCHAR(255),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (season_id, fpl_id)
);


-- =========================================================
-- FPL MANAGERS
-- =========================================================

CREATE TABLE fpl_managers (
    id BIGSERIAL PRIMARY KEY,

    fpl_id INTEGER NOT NULL UNIQUE,

    first_name VARCHAR(100),
    last_name VARCHAR(100),

    team_name VARCHAR(100),

    country VARCHAR(100),

    started_event INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- MANAGER GAMEWEEK SCORES
-- =========================================================

CREATE TABLE manager_gameweek_scores (
    id BIGSERIAL PRIMARY KEY,

    manager_id BIGINT NOT NULL REFERENCES fpl_managers(id) ON DELETE CASCADE,

    gameweek_id BIGINT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,

    points INTEGER,
    total_points INTEGER,

    overall_rank INTEGER,
    gameweek_rank INTEGER,

    bank INTEGER,
    team_value INTEGER,

    transfers INTEGER,
    transfer_cost INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (manager_id, gameweek_id)
);


-- =========================================================
-- MANAGER GAMEWEEK PICKS
-- =========================================================

CREATE TABLE manager_gameweek_picks (
    id BIGSERIAL PRIMARY KEY,

    manager_id BIGINT NOT NULL REFERENCES fpl_managers(id) ON DELETE CASCADE,

    gameweek_id BIGINT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,

    player_id BIGINT NOT NULL REFERENCES fpl_players(id) ON DELETE CASCADE,

    position INTEGER NOT NULL,

    multiplier INTEGER NOT NULL DEFAULT 1,

    is_captain BOOLEAN NOT NULL DEFAULT false,
    is_vice_captain BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (manager_id, gameweek_id, position)
);