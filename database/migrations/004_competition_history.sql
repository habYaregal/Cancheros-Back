-- =========================================================
-- COMPETITION HISTORY
-- Snapshot of finalized Cancheros winners so GW1–GW38
-- (and months / season / H2H) remain preserved.
-- =========================================================

CREATE TABLE IF NOT EXISTS competition_results (
    id BIGSERIAL PRIMARY KEY,

    cancheros_id BIGINT NOT NULL
        REFERENCES cancheros(id)
        ON DELETE CASCADE,

    competition_type VARCHAR(20) NOT NULL
        CHECK (
            competition_type IN (
                'weekly',
                'monthly',
                'season',
                'h2h'
            )
        ),

    season_id BIGINT
        REFERENCES seasons(id)
        ON DELETE CASCADE,

    gameweek_id BIGINT
        REFERENCES gameweeks(id)
        ON DELETE CASCADE,

    competition_month_id BIGINT
        REFERENCES competition_months(id)
        ON DELETE CASCADE,

    tied BOOLEAN NOT NULL DEFAULT false,

    resolved_by VARCHAR(50),

    finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_results_weekly
    ON competition_results (cancheros_id, gameweek_id)
    WHERE competition_type = 'weekly';

CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_results_monthly
    ON competition_results (cancheros_id, competition_month_id)
    WHERE competition_type = 'monthly';

CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_results_season
    ON competition_results (cancheros_id, season_id)
    WHERE competition_type = 'season';

CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_results_h2h
    ON competition_results (cancheros_id, season_id)
    WHERE competition_type = 'h2h';


CREATE TABLE IF NOT EXISTS competition_result_winners (
    id BIGSERIAL PRIMARY KEY,

    result_id BIGINT NOT NULL
        REFERENCES competition_results(id)
        ON DELETE CASCADE,

    member_id BIGINT NOT NULL
        REFERENCES cancheros_members(id)
        ON DELETE RESTRICT,

    points NUMERIC,

    wins INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (result_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_competition_result_winners_member
    ON competition_result_winners (member_id);
