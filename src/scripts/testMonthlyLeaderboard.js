import { pool } from "../config/database.js";
import { getMonthlyLeaderboard } from "../services/competitions/monthly.js";

async function run() {
    try {
        const result = await pool.query(`
      SELECT id, name
      FROM competition_months
      WHERE season_id = 1
      ORDER BY start_date
      LIMIT 1;
    `);

        if (result.rows.length === 0) {
            throw new Error("No competition month found.");
        }

        const month = result.rows[0];

        console.log("\n==============================");
        console.log("MONTHLY LEADERBOARD TEST");
        console.log("==============================");

        console.log(
            `Month: ${month.name} (ID: ${month.id})`
        );

        const leaderboard = await getMonthlyLeaderboard(
            month.id
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