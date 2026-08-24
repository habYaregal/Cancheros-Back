import { pool } from "../../config/database.js";
import { getManagerHistory } from "./fpl.client.js";

export async function syncCancherosGameweek(
  gameweekFplId,
  db = pool
) {
  // Find Cancheros
  const cancherosResult = await db.query(
    `
    SELECT id, name, start_gameweek
    FROM cancheros
    WHERE name = 'Cancheros'
    LIMIT 1;
    `
  );

  if (cancherosResult.rows.length === 0) {
    throw new Error("Cancheros league not found.");
  }

  const cancheros = cancherosResult.rows[0];

  // Don't sync before the league's start gameweek
  if (gameweekFplId < cancheros.start_gameweek) {
    return {
      synced: 0,
      message: "Gameweek is before Cancheros start."
    };
  }

  // Get active members
  const membersResult = await db.query(
    `
    SELECT
      cm.id,
      cm.manager_id,
      cm.participation_start_gw,
      fm.fpl_id,
      fm.first_name,
      fm.last_name
    FROM cancheros_members cm
    JOIN fpl_managers fm
      ON fm.id = cm.manager_id
    WHERE cm.cancheros_id = $1
      AND cm.active = true
      AND cm.participation_start_gw <= $2
    ORDER BY cm.id;
    `,
    [cancheros.id, gameweekFplId]
  );

  const results = [];

  for (const member of membersResult.rows) {
    try {
      const history = await getManagerHistory(member.fpl_id);

      if (!history.current || history.current.length === 0) {
        results.push({
          managerId: member.fpl_id,
          name: `${member.first_name} ${member.last_name}`,
          synced: false,
          reason: "No current season data"
        });

        continue;
      }

      const event = history.current.find(
        (item) => item.event === gameweekFplId
      );

      if (!event) {
        results.push({
          managerId: member.fpl_id,
          name: `${member.first_name} ${member.last_name}`,
          synced: false,
          reason: "Gameweek data not available"
        });

        continue;
      }

      // Find database gameweek
      const gameweekResult = await db.query(
        `
        SELECT id
        FROM gameweeks
        WHERE fpl_id = $1
        LIMIT 1;
        `,
        [gameweekFplId]
      );

      if (gameweekResult.rows.length === 0) {
        throw new Error(
          `Gameweek ${gameweekFplId} not found in database.`
        );
      }

      const gameweekId = gameweekResult.rows[0].id;

      // Insert/update score
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
          member.manager_id,
          gameweekId,
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

      results.push({
        managerId: member.fpl_id,
        name: `${member.first_name} ${member.last_name}`,
        synced: true,
        points: event.points,
        totalPoints: event.total_points
      });

    } catch (error) {
      results.push({
        managerId: member.fpl_id,
        name: `${member.first_name} ${member.last_name}`,
        synced: false,
        error: error.message
      });
    }
  }

  return {
    cancheros: cancheros.name,
    gameweek: gameweekFplId,
    members: results
  };
}