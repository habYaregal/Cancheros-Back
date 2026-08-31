import { pool } from "../../config/database.js";
import { gameweekPointsSql } from "./points.js";

export async function getMonthlyLeaderboard(
  competitionMonthId,
  db = pool
) {
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
      COALESCE(SUM(${gameweekPointsSql}), 0)::integer AS points,
      COUNT(mgs.id)::integer AS gameweeks_played

    FROM cancheros_members cm

    JOIN cancheros c
      ON c.id = cm.cancheros_id

    JOIN fpl_managers fm
      ON fm.id = cm.manager_id

    JOIN gameweeks g
      ON g.competition_month_id = $1
      AND g.fpl_id >= cm.participation_start_gw

    LEFT JOIN manager_gameweek_scores mgs
      ON mgs.manager_id = fm.id
      AND mgs.gameweek_id = g.id

    WHERE c.name = 'Cancheros'
      AND cm.active = true

    GROUP BY
      cm.id,
      fm.id,
      fm.fpl_id,
      fm.first_name,
      fm.last_name,
      fm.team_name,
      cm.display_name

    ORDER BY points DESC;
    `,
    [competitionMonthId]
  );

  return result.rows;
}