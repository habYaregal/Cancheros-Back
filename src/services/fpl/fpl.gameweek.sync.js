import { pool } from "../../config/database.js";
import { getBootstrapStatic } from "./fpl.client.js";

export async function syncGameweeks(db = pool) {
  // Get the current season from our database
  const seasonResult = await db.query(
    `
    SELECT id
    FROM seasons
    WHERE is_current = true
    ORDER BY id DESC
    LIMIT 1;
    `
  );

  if (seasonResult.rows.length === 0) {
    throw new Error("No current season found.");
  }

  const seasonId = seasonResult.rows[0].id;

  // Get current FPL data
  const bootstrap = await getBootstrapStatic();

  if (!bootstrap.events || !Array.isArray(bootstrap.events)) {
    throw new Error("FPL bootstrap data does not contain events.");
  }

  let synced = 0;

  for (const event of bootstrap.events) {
    await db.query(
      `
      INSERT INTO gameweeks (
        season_id,
        fpl_id,
        name,
        deadline_time,
        finished,
        is_previous,
        is_current,
        is_next
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (season_id, fpl_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        deadline_time = EXCLUDED.deadline_time,
        finished = EXCLUDED.finished,
        is_previous = EXCLUDED.is_previous,
        is_current = EXCLUDED.is_current,
        is_next = EXCLUDED.is_next
      `,
      [
        seasonId,
        event.id,
        event.name,
        event.deadline_time,
        event.finished,
        event.is_previous,
        event.is_current,
        event.is_next,
      ]
    );

    synced++;
  }

  return {
    seasonId,
    synced,
  };
}