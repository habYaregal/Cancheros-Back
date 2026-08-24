import { pool } from "./config/database.js";

async function run() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get Cancheros members
    const members = await client.query(
      `
      SELECT
        cm.manager_id,
        cm.display_name
      FROM cancheros_members cm
      JOIN cancheros c
        ON c.id = cm.cancheros_id
      WHERE c.name = 'Cancheros'
        AND cm.active = true
      ORDER BY cm.id;
      `
    );

    // Get GW1
    const gameweek = await client.query(
      `
      SELECT id
      FROM gameweeks
      WHERE fpl_id = 1
      LIMIT 1;
      `
    );

    if (gameweek.rows.length === 0) {
      throw new Error("GW1 not found.");
    }

    const gameweekId = gameweek.rows[0].id;

    // Fake scores
    const fakeScores = [72, 81, 65];

    for (let i = 0; i < members.rows.length; i++) {
      await client.query(
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
          $1, $2, $3, 0, 0, 0, 0, 0, 0, 0
        );
        `,
        [
          members.rows[i].manager_id,
          gameweekId,
          fakeScores[i],
        ]
      );
    }

    // Get leaderboard
    const leaderboard = await client.query(
      `
      SELECT
        fm.id AS manager_id,
        cm.display_name,
        mgs.points
      FROM manager_gameweek_scores mgs
      JOIN fpl_managers fm
        ON fm.id = mgs.manager_id
      JOIN cancheros_members cm
        ON cm.manager_id = fm.id
      JOIN cancheros c
        ON c.id = cm.cancheros_id
      WHERE c.name = 'Cancheros'
        AND mgs.gameweek_id = $1
      ORDER BY mgs.points DESC;
      `,
      [gameweekId]
    );

    console.table(leaderboard.rows);

    await client.query("ROLLBACK");

    console.log("\nTest completed.");
    console.log("Fake scores were rolled back.");
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Test failed:");
    console.error(error);

    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();