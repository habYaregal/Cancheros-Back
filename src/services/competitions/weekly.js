import { pool } from "../../config/database.js";

export async function getWeeklyLeaderboard(gameweekFplId, db = pool) {
  const result = await db.query(
    `
    SELECT
      cm.id AS member_id,
      fm.id AS manager_id,
      fm.fpl_id,
      fm.first_name,
      fm.last_name,
      fm.team_name,
      cm.display_name,
      mgs.points
    FROM manager_gameweek_scores mgs

    JOIN fpl_managers fm
      ON fm.id = mgs.manager_id

    JOIN cancheros_members cm
      ON cm.manager_id = fm.id

    JOIN cancheros c
      ON c.id = cm.cancheros_id

    JOIN gameweeks g
      ON g.id = mgs.gameweek_id

    WHERE c.name = 'Cancheros'
      AND cm.active = true
      AND g.fpl_id = $1
      AND cm.participation_start_gw <= $1

    ORDER BY mgs.points DESC;
    `,
    [gameweekFplId]
  );

  return result.rows;
}