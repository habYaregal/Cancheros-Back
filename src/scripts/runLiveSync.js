import { pool } from "../config/database.js";
import { runLiveSync } from "../services/sync/gameweek.pipeline.js";
import { getH2HStandings } from "../services/competitions/h2h.js";

async function run() {
  try {
    console.log("\n==============================");
    console.log("LIVE SYNC (current GW)");
    console.log("==============================\n");

    const summary = await runLiveSync();

    console.log("Target:", summary.targetGameweek);
    console.log(
      "Members:",
      summary.members?.fplMemberCount,
      "added",
      summary.members?.added?.length,
      "updated",
      summary.members?.updated?.length
    );
    console.log(
      "Scores synced:",
      (summary.scores?.members || []).filter((m) => m.synced)
        .length
    );
    console.log("Lottery:", summary.lottery);
    console.log("H2H:", {
      processed: summary.h2hResults?.processed,
      refreshed: summary.h2hResults?.refreshed,
      changed: summary.h2hResults?.changed,
      provisional: summary.h2hResults?.results?.[0]?.provisional,
    });

    if (summary.scores?.members) {
      console.log("\n--- GW scores ---");
      console.table(
        summary.scores.members.map((row) => ({
          manager: row.name,
          points: row.points,
        }))
      );
    }

    if (summary.h2hResults?.results) {
      console.log("\n--- H2H refresh ---");
      console.table(
        summary.h2hResults.results.map((row) => ({
          match: row.matchId,
          score:
            row.type === "bye"
              ? "BYE"
              : `${row.playerOneScore}-${row.playerTwoScore}`,
          h2h:
            row.type === "bye"
              ? "1.5"
              : `${row.playerOnePoints}-${row.playerTwoPoints}`,
          changed: row.changed,
          provisional: row.provisional,
        }))
      );
    }

    const cancheros = await pool.query(`
      SELECT id FROM cancheros WHERE name = 'Cancheros' LIMIT 1;
    `);

    const standings = await getH2HStandings(
      cancheros.rows[0].id
    );

    console.log("\n--- H2H table ---");
    console.table(
      standings.map((row, index) => ({
        pos: index + 1,
        manager: `${row.first_name} ${row.last_name}`,
        P: row.played,
        W: row.wins,
        D: row.draws,
        L: row.losses,
        Pts: row.points,
      }))
    );

    console.log("\nLive sync OK.\n");
  } catch (error) {
    console.error("Live sync failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
