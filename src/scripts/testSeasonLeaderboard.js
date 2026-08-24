import { pool } from "../config/database.js";
import { getSeasonLeaderboard } from "../services/competitions/season.js";

async function run() {
  try {
    const result = await pool.query(`
      SELECT id, name
      FROM seasons
      WHERE is_current = true
      LIMIT 1;
    `);

    if (result.rows.length === 0) {
      throw new Error("No current season found.");
    }

    const season = result.rows[0];

    console.log("\n==============================");
    console.log("SEASON LEADERBOARD TEST");
    console.log("==============================");

    console.log(
      `Season: ${season.name} (ID: ${season.id})`
    );

    const leaderboard = await getSeasonLeaderboard(
      season.id
    );

    console.table(
      leaderboard.map((manager, index) => ({
        position: index + 1,
        manager: `${manager.first_name} ${manager.last_name}`,
        team: manager.team_name,
        points: manager.points,
        gameweeks: manager.gameweeks_played,
      }))
    );
  } catch (error) {
    console.error("Test failed:");
    console.error(error);
  } finally {
    await pool.end();
  }
}

run();