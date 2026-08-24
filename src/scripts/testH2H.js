import { pool } from "../config/database.js";
import { getH2HStandings } from "../services/competitions/h2h.js";

async function run() {
  try {
    const result = await pool.query(`
      SELECT id, name
      FROM cancheros
      WHERE name = 'Cancheros'
      LIMIT 1;
    `);

    if (result.rows.length === 0) {
      throw new Error("Cancheros league not found.");
    }

    const cancheros = result.rows[0];

    console.log("\n==============================");
    console.log("H2H STANDINGS TEST");
    console.log("==============================");

    const standings = await getH2HStandings(
      cancheros.id
    );

    console.table(
      standings.map((player, index) => ({
        position: index + 1,
        manager:
          `${player.first_name} ${player.last_name}`,
        team: player.team_name,
        played: player.played,
        wins: player.wins,
        draws: player.draws,
        losses: player.losses,
        points: player.points,
      }))
    );
  } catch (error) {
    console.error("H2H test failed:");
    console.error(error);
  } finally {
    await pool.end();
  }
}

run();