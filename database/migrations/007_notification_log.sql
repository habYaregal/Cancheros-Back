-- =========================================================
-- NOTIFICATION LOG (idempotency guard for Telegram notifs)
-- =========================================================

CREATE TABLE IF NOT EXISTS notification_log (
    cancheros_id   BIGINT NOT NULL REFERENCES cancheros(id) ON DELETE CASCADE,
    gameweek_id    BIGINT NOT NULL REFERENCES gameweeks(id) ON DELETE CASCADE,
    event_type     VARCHAR(32) NOT NULL
        CHECK (event_type IN ('gw_end_summary', 'h2h_draw', 'deadline_4h')),
    sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_count     INTEGER NOT NULL DEFAULT 0,
    failed_count   INTEGER NOT NULL DEFAULT 0,
    errors_json    JSONB,

    PRIMARY KEY (cancheros_id, gameweek_id, event_type)
);
