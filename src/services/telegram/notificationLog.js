import { pool } from "../../config/database.js";

const VALID_EVENTS = new Set([
  "gw_end_summary",
  "h2h_draw",
  "deadline_4h",
]);

export const NOTIFICATION_EVENT = Object.freeze({
  GW_END_SUMMARY: "gw_end_summary",
  H2H_DRAW: "h2h_draw",
  DEADLINE_4H: "deadline_4h",
});

function validateEvent(eventType) {
  if (!VALID_EVENTS.has(eventType)) {
    throw new Error(`Invalid notification event_type: ${eventType}`);
  }
}

export async function hasNotified(
  cancherosId,
  gameweekId,
  eventType,
  db = pool
) {
  try {
    validateEvent(eventType);
    if (!cancherosId || !gameweekId) return false;

    const result = await db.query(
      `
      SELECT 1
      FROM notification_log
      WHERE cancheros_id = $1
        AND gameweek_id = $2
        AND event_type = $3
      LIMIT 1;
      `,
      [cancherosId, gameweekId, eventType]
    );

    return result.rows.length > 0;
  } catch (err) {
    console.warn(
      `[notif-log:hasNotified] falling back to false (${eventType}):`,
      err.message || String(err)
    );
    return false;
  }
}

export async function markNotified(
  {
    cancherosId,
    gameweekId,
    eventType,
    sent = 0,
    failed = 0,
    errors = null,
  },
  db = pool
) {
  try {
    validateEvent(eventType);
    if (!cancherosId || !gameweekId) return null;

    const result = await db.query(
      `
      INSERT INTO notification_log (
        cancheros_id, gameweek_id, event_type,
        sent_at, sent_count, failed_count, errors_json
      )
      VALUES ($1, $2, $3, NOW(), $4, $5, $6::jsonb)
      ON CONFLICT (cancheros_id, gameweek_id, event_type) DO NOTHING
      RETURNING *;
      `,
      [
        cancherosId,
        gameweekId,
        eventType,
        Number(sent) || 0,
        Number(failed) || 0,
        errors ? JSON.stringify(errors) : null,
      ]
    );

    return result.rows[0] || null;
  } catch (err) {
    console.warn(
      `[notif-log:markNotified] failed (${eventType}):`,
      err.message || String(err)
    );
    return null;
  }
}
