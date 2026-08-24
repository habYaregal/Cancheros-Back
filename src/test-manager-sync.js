import { syncFplManager } from "./services/fpl/fpl.manager.sync.js";
import { pool } from "./config/database.js";

const ENTRY_ID = 3142173;

async function run() {
  try {
    const manager = await syncFplManager(ENTRY_ID);

    console.log("FPL manager synchronized:");
    console.dir(manager, { depth: null });
  } catch (error) {
    console.error("Manager sync failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();