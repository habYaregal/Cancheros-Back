import { pool } from "../config/database.js";
import { runGameweekPipeline } from "../services/sync/gameweek.pipeline.js";

async function run() {
  try {
    const arg = process.argv[2];
    const gameweekFplId = arg
      ? Number(arg)
      : null;

    if (arg && Number.isNaN(gameweekFplId)) {
      throw new Error(
        `Invalid gameweek: ${arg}`
      );
    }

    console.log("\n==============================");
    console.log("CANCHEROS GAMEWEEK PIPELINE");
    console.log("==============================");

    if (gameweekFplId) {
      console.log(`Target: GW${gameweekFplId}`);
    } else {
      console.log("Target: previous/current GW");
    }

    const summary = await runGameweekPipeline({
      gameweekFplId,
    });

    console.log("\nGameweeks synced:", summary.gameweeks);
    console.log("\nMembers synced:", {
      fplCount: summary.members?.fplMemberCount,
      added: summary.members?.added?.length,
      updated: summary.members?.updated?.length,
      deactivated: summary.members?.deactivated?.length,
    });
    console.log("Target gameweek:", summary.targetGameweek);
    console.log("\nScores:");
    console.dir(summary.scores, { depth: 3 });
    console.log("\nLottery:", {
      created: summary.lottery?.created,
      roundId: summary.lottery?.roundId,
      matches: summary.lottery?.matches?.length,
    });
    console.log("\nH2H results:");
    console.dir(summary.h2hResults, { depth: 3 });
    console.log("\nWeekly history:", summary.weekly);
    console.log("Monthly history:", summary.monthly);
    console.log("Season history:", summary.season);
    console.log("H2H award:", summary.h2hAward);

    if (summary.message) {
      console.log("\nMessage:", summary.message);
    }

    console.log("\n==============================");
    console.log("PIPELINE COMPLETE");
    console.log("==============================\n");
  } catch (error) {
    console.error("\nPipeline failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
