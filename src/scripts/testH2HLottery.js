import { pool } from "../config/database.js";
import { generateH2HLottery } from "../services/competitions/h2h.lottery.js";

async function run() {
  try {
    /*
     * Get Cancheros.
     */
    const cancherosResult = await pool.query(`
      SELECT id, name
      FROM cancheros
      WHERE name = 'Cancheros'
      LIMIT 1;
    `);

    if (cancherosResult.rows.length === 0) {
      throw new Error("Cancheros league not found.");
    }

    const cancheros = cancherosResult.rows[0];

    /*
     * Get GW1.
     */
    const gameweekResult = await pool.query(`
      SELECT id, fpl_id, name
      FROM gameweeks
      WHERE fpl_id = 1
        AND season_id = (
          SELECT id
          FROM seasons
          WHERE is_current = true
          LIMIT 1
        )
      LIMIT 1;
    `);

    if (gameweekResult.rows.length === 0) {
      throw new Error("Gameweek 1 not found.");
    }

    const gameweek = gameweekResult.rows[0];

    console.log("\n==============================");
    console.log("H2H LOTTERY TEST");
    console.log("==============================");

    console.log(`League: ${cancheros.name}`);
    console.log(`Gameweek: ${gameweek.name}`);

    const result = await generateH2HLottery(
      cancheros.id,
      gameweek.id
    );

    console.log("\nRound ID:", result.roundId);
    console.log("Created:", result.created);

    /*
     * Get readable match information.
     */
    const matchesResult = await pool.query(
      `
      SELECT
        hm.id,

        p1.first_name AS p1_first_name,
        p1.last_name AS p1_last_name,
        p1.team_name AS p1_team,

        p2.first_name AS p2_first_name,
        p2.last_name AS p2_last_name,
        p2.team_name AS p2_team,

        hm.player_one_points,
        hm.player_two_points,
        hm.is_bye,
        hm.completed

      FROM h2h_matches hm

      JOIN cancheros_members cm1
        ON cm1.id = hm.player_one_id

      JOIN fpl_managers p1
        ON p1.id = cm1.manager_id

      LEFT JOIN cancheros_members cm2
        ON cm2.id = hm.player_two_id

      LEFT JOIN fpl_managers p2
        ON p2.id = cm2.manager_id

      WHERE hm.round_id = $1

      ORDER BY hm.id;
      `,
      [result.roundId]
    );

    console.table(
      matchesResult.rows.map((match) => ({
        match: match.id,

        player1:
          `${match.p1_first_name} ${match.p1_last_name}`,

        team1: match.p1_team,

        player2: match.is_bye
          ? "BYE"
          : `${match.p2_first_name} ${match.p2_last_name}`,

        team2: match.is_bye
          ? "-"
          : match.p2_team,

        points1: match.player_one_points,
        points2: match.player_two_points,

        bye: match.is_bye,
      }))
    );

    console.log("\nTest completed.");
  } catch (error) {
    console.error("\nH2H lottery test failed:");
    console.error(error);
  } finally {
    await pool.end();
  }
}

run();