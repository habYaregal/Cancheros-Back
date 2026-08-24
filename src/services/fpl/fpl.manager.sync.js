import { pool } from "../../config/database.js";
import { getManager } from "./fpl.client.js";

export async function syncFplManager(entryId, db = pool) {
  const manager = await getManager(entryId);

  const result = await db.query(
    `
    INSERT INTO fpl_managers (
      fpl_id,
      first_name,
      last_name,
      team_name,
      country,
      started_event
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (fpl_id)
    DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      team_name = EXCLUDED.team_name,
      country = EXCLUDED.country,
      started_event = EXCLUDED.started_event,
      updated_at = NOW()
    RETURNING *;
    `,
    [
      manager.id,
      manager.player_first_name,
      manager.player_last_name,
      manager.name,
      manager.player_region_name,
      manager.started_event,
    ]
  );

  return result.rows[0];
}