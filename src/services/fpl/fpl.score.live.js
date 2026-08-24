import { pool } from "../../config/database.js";
import { getClassicLeagueStandings } from "./fpl.client.js";
import { CANCHEROS_FPL_LEAGUE_ID } from "../cancheros/cancheros.members.js";

/**
 * Fast live score sync from the classic league table.
 * One FPL request updates every Cancheros member.
 *
 * Uses event_total (live GW points) while the GW
 * is unfinished — much fresher than /history/.
 */
export async function syncCancherosScoresFromLeague(
  gameweekFplId,
  db = pool
) {
  const cancherosResult = await db.query(
    `
    SELECT id, name, start_gameweek, fpl_league_id
    FROM cancheros
    WHERE fpl_league_id = $1
    LIMIT 1;
    `,
    [CANCHEROS_FPL_LEAGUE_ID]
  );

  if (cancherosResult.rows.length === 0) {
    throw new Error("Cancheros league was not found.");
  }

  const cancheros = cancherosResult.rows[0];

  if (gameweekFplId < cancheros.start_gameweek) {
    return {
      synced: 0,
      source: "league",
      message: "Gameweek is before Cancheros start.",
    };
  }

  const gameweekResult = await db.query(
    `
    SELECT id, fpl_id, finished
    FROM gameweeks
    WHERE fpl_id = $1
    LIMIT 1;
    `,
    [gameweekFplId]
  );

  if (gameweekResult.rows.length === 0) {
    throw new Error(`Gameweek ${gameweekFplId} not found.`);
  }

  const gameweek = gameweekResult.rows[0];

  const { standings } = await getClassicLeagueStandings(
    cancheros.fpl_league_id
  );

  const membersResult = await db.query(
    `
    SELECT
      cm.id AS member_id,
      cm.manager_id,
      fm.fpl_id,
      fm.first_name,
      fm.last_name
    FROM cancheros_members cm
    JOIN fpl_managers fm
      ON fm.id = cm.manager_id
    WHERE cm.cancheros_id = $1
      AND cm.active = true
      AND cm.participation_start_gw <= $2;
    `,
    [cancheros.id, gameweekFplId]
  );

  const byFplId = new Map(
    membersResult.rows.map((row) => [Number(row.fpl_id), row])
  );

  const results = [];

  for (const row of standings) {
    const member = byFplId.get(Number(row.entry));

    if (!member) {
      continue;
    }

    await db.query(
      `
      INSERT INTO manager_gameweek_scores (
        manager_id,
        gameweek_id,
        points,
        total_points,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (manager_id, gameweek_id)
      DO UPDATE SET
        points = EXCLUDED.points,
        total_points = EXCLUDED.total_points,
        updated_at = NOW();
      `,
      [
        member.manager_id,
        gameweek.id,
        row.event_total,
        row.total,
      ]
    );

    results.push({
      managerId: member.fpl_id,
      name: `${member.first_name} ${member.last_name}`,
      synced: true,
      points: row.event_total,
      totalPoints: row.total,
    });
  }

  return {
    cancheros: cancheros.name,
    gameweek: gameweekFplId,
    source: "league",
    provisional: !gameweek.finished,
    members: results,
  };
}
