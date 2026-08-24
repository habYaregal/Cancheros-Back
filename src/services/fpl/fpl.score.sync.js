import { pool } from "../../config/database.js";
import { getManagerHistory } from "./fpl.client.js";

export async function syncManagerGameweekScore(
  managerId,
  gameweekFplId,
  db = pool
) {
  // Get our database manager
  const managerResult = await db.query(
    `
    SELECT id, fpl_id
    FROM fpl_managers
    WHERE id = $1
    LIMIT 1;
    `,
    [managerId]
  );

  if (managerResult.rows.length === 0) {
    throw new Error(`Manager ${managerId} not found.`);
  }

  const manager = managerResult.rows[0];

  // Get the corresponding gameweek
  const gameweekResult = await db.query(
    `
    SELECT id, fpl_id
    FROM gameweeks
    WHERE fpl_id = $1
    LIMIT 1;
    `,
    [gameweekFplId]
  );

  if (gameweekResult.rows.length === 0) {
    throw new Error(
      `Gameweek with FPL ID ${gameweekFplId} not found.`
    );
  }

  const gameweek = gameweekResult.rows[0];

  // Get FPL manager history
  const history = await getManagerHistory(manager.fpl_id);

  // Current season has no completed gameweeks yet
  if (!history.current || history.current.length === 0) {
    return {
      synced: false,
      reason: "No current gameweek data available yet.",
      managerId: manager.fpl_id,
      gameweek: gameweekFplId,
    };
  }

  // Find the requested gameweek
  const event = history.current.find(
    (item) => item.event === gameweekFplId
  );

  // The gameweek may not have finished yet
  if (!event) {
    return {
      synced: false,
      reason: "Gameweek data not available yet.",
      managerId: manager.fpl_id,
      gameweek: gameweekFplId,
    };
  }

  // Store/update the score
  await db.query(
    `
    INSERT INTO manager_gameweek_scores (
      manager_id,
      gameweek_id,
      points,
      total_points,
      overall_rank,
      gameweek_rank,
      bank,
      team_value,
      transfers,
      transfer_cost
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10
    )
    ON CONFLICT (manager_id, gameweek_id)
    DO UPDATE SET
      points = EXCLUDED.points,
      total_points = EXCLUDED.total_points,
      overall_rank = EXCLUDED.overall_rank,
      gameweek_rank = EXCLUDED.gameweek_rank,
      bank = EXCLUDED.bank,
      team_value = EXCLUDED.team_value,
      transfers = EXCLUDED.transfers,
      transfer_cost = EXCLUDED.transfer_cost,
      updated_at = NOW();
    `,
    [
      manager.id,
      gameweek.id,
      event.points,
      event.total_points,
      event.overall_rank,
      event.rank,
      event.bank,
      event.value,
      event.event_transfers,
      event.event_transfers_cost,
    ]
  );

  return {
    synced: true,
    managerId: manager.fpl_id,
    gameweek: gameweekFplId,
    points: event.points,
    totalPoints: event.total_points,
  };
}