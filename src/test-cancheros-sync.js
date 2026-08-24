import { pool } from "./config/database.js";
import { syncCancherosGameweek } from "./services/fpl/fpl.cancheros.sync.js";

async function run() {
  try {
    console.log("================================");
    console.log("CANCHEROS GAMEWEEK SYNC");
    console.log("================================");

    const result = await syncCancherosGameweek(1);

    console.dir(result, { depth: null });

    console.log("\nDatabase scores:");

    const scores = await pool.query(
      `
      SELECT
        mgs.id,
        fm.first_name,
        fm.last_name,
        g.fpl_id AS gameweek,
        mgs.points,
        mgs.total_points
      FROM manager_gameweek_scores mgs
      JOIN fpl_managers fm
        ON fm.id = mgs.manager_id
      JOIN gameweeks g
        ON g.id = mgs.gameweek_id
      ORDER BY g.fpl_id, fm.id;
      `
    );

    console.table(scores.rows);

  } catch (error) {
    console.error("Cancheros sync failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();