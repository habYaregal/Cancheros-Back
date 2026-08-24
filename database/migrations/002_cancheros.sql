-- =========================================================
-- CANCHEROS COMPETITION
-- =========================================================

CREATE TABLE cancheros (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(100) NOT NULL,

    fpl_league_id INTEGER UNIQUE,

    max_members INTEGER NOT NULL DEFAULT 20,

    start_gameweek INTEGER NOT NULL DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- CANCHEROS MEMBERS
-- =========================================================

CREATE TABLE cancheros_members (
    id BIGSERIAL PRIMARY KEY,

    cancheros_id BIGINT NOT NULL
        REFERENCES cancheros(id)
        ON DELETE CASCADE,

    manager_id BIGINT NOT NULL
        REFERENCES fpl_managers(id)
        ON DELETE RESTRICT,

    display_name VARCHAR(100),

    participation_start_gw INTEGER NOT NULL DEFAULT 1,

    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    active BOOLEAN NOT NULL DEFAULT true,

    UNIQUE (cancheros_id, manager_id)
);


-- =========================================================
-- ENSURE ONE ACTIVE CANCHEROS COMPETITION
-- =========================================================

INSERT INTO cancheros (
    name,
    fpl_league_id,
    max_members,
    start_gameweek
)
VALUES (
    'Cancheros',
    696420,
    20,
    1
);