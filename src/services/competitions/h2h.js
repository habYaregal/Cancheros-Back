import { pool } from "../../config/database.js";

/**
 * Season H2H table for active Cancheros members.
 *
 * BYE awards 1.5 points but does not count as
 * a played match (and never as a win/draw/loss).
 */
export async function getH2HStandings(
  cancherosId,
  db = pool
) {
  const result = await db.query(
    `
    SELECT
      cm.id AS member_id,
      fm.fpl_id,
      fm.first_name,
      fm.last_name,
      fm.team_name,

      COALESCE(SUM(
        CASE
          WHEN hm.player_one_id = cm.id
            THEN hm.player_one_points

          WHEN hm.player_two_id = cm.id
            THEN hm.player_two_points

          ELSE 0
        END
      ), 0)::numeric AS points,

      COUNT(*) FILTER (
        WHERE hm.id IS NOT NULL
          AND hm.is_bye = false
      )::integer AS played,

      COUNT(*) FILTER (
        WHERE
          hm.id IS NOT NULL
          AND hm.is_bye = false
          AND (
            (
              hm.player_one_id = cm.id
              AND hm.player_one_points = 3
            )
            OR
            (
              hm.player_two_id = cm.id
              AND hm.player_two_points = 3
            )
          )
      )::integer AS wins,

      COUNT(*) FILTER (
        WHERE
          hm.id IS NOT NULL
          AND hm.is_bye = false
          AND (
            (
              hm.player_one_id = cm.id
              AND hm.player_one_points = 1
            )
            OR
            (
              hm.player_two_id = cm.id
              AND hm.player_two_points = 1
            )
          )
      )::integer AS draws,

      COUNT(*) FILTER (
        WHERE
          hm.id IS NOT NULL
          AND hm.is_bye = false
          AND (
            (
              hm.player_one_id = cm.id
              AND hm.player_one_points = 0
            )
            OR
            (
              hm.player_two_id = cm.id
              AND hm.player_two_points = 0
            )
          )
      )::integer AS losses

    FROM cancheros_members cm

    JOIN fpl_managers fm
      ON fm.id = cm.manager_id

    LEFT JOIN h2h_rounds hr
      ON hr.cancheros_id = cm.cancheros_id

    LEFT JOIN h2h_matches hm
      ON hm.round_id = hr.id
      AND hm.completed = true
      AND (
        hm.player_one_id = cm.id
        OR hm.player_two_id = cm.id
      )

    WHERE
      cm.cancheros_id = $1
      AND cm.active = true

    GROUP BY
      cm.id,
      fm.fpl_id,
      fm.first_name,
      fm.last_name,
      fm.team_name

    ORDER BY
      points DESC,
      wins DESC,
      played DESC,
      fm.last_name ASC,
      fm.first_name ASC;
    `,
    [cancherosId]
  );

  return result.rows.map(normalizeStandingRow);
}

function normalizeStandingRow(row) {
  return {
    ...row,
    points: Number(row.points),
    played: Number(row.played),
    wins: Number(row.wins),
    draws: Number(row.draws),
    losses: Number(row.losses),
  };
}
