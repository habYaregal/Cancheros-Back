import { pool } from "./config/database.js";
import { syncGameweeks } from "./services/fpl/fpl.gameweek.sync.js";

async function run() {
  try {
    console.log("================================");
    console.log("FPL GAMEWEEK SYNC");
    console.log("================================");

    const result = await syncGameweeks();

    console.log("\nSync completed:");
    console.dir(result, { depth: null });

    const gameweeks = await pool.query(
      `
      SELECT
        id,
        season_id,
        fpl_id,
        name,
        deadline_time,
        finished,
        is_previous,
        is_current,
        is_next
      FROM gameweeks
      ORDER BY fpl_id;
      `
    );

    console.log("\nGameweeks in database:");
    console.table(gameweeks.rows);
  } catch (error) {
    console.error("\nGameweek sync failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();