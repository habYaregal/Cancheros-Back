import { pool } from "../config/database.js";
import { syncCancherosMembersFromFpl } from "../services/cancheros/cancheros.members.js";

async function run() {
  try {
    console.log("\n==============================");
    console.log("SYNC CANCHEROS MEMBERS FROM FPL");
    console.log("==============================\n");

    const result = await syncCancherosMembersFromFpl();

    console.log(`FPL league: ${result.fplLeagueName}`);
    console.log(`FPL members: ${result.fplMemberCount}`);
    console.log(`Added: ${result.added.length}`);
    console.log(`Updated: ${result.updated.length}`);
    console.log(`Deactivated: ${result.deactivated.length}`);

    if (result.added.length > 0) {
      console.log("\n--- Added ---");
      console.table(
        result.added.map((row) => ({
          fplId: row.fplId,
          player: row.playerName,
          team: row.teamName,
          startGw: row.participationStartGw,
        }))
      );
    }

    if (result.deactivated.length > 0) {
      console.log("\n--- Deactivated ---");
      console.table(
        result.deactivated.map((row) => ({
          fplId: row.fplId,
          manager: `${row.firstName} ${row.lastName}`,
          team: row.teamName,
        }))
      );
    }

    console.log("\n--- Current Cancheros roster ---");
    console.table(
      result.members.map((row) => ({
        active: row.active,
        fplId: row.fpl_id,
        manager: `${row.first_name} ${row.last_name}`,
        team: row.team_name,
        display: row.display_name,
        startGw: row.participation_start_gw,
      }))
    );

    console.log("\n==============================");
    console.log("MEMBER SYNC COMPLETE");
    console.log("==============================\n");
  } catch (error) {
    console.error("Member sync failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
