import { pool } from "../config/database.js";
import {
  recordWeeklyResult,
  getCompetitionHistory,
} from "../services/competitions/history.js";

function label(player) {
  return `${player.first_name} ${player.last_name}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

async function run() {
  const client = await pool.connect();

  try {
    console.log("\n==============================");
    console.log("COMPETITION HISTORY TEST");
    console.log("==============================");

    await client.query("BEGIN");

    const cancheros = await client.query(`
      SELECT id
      FROM cancheros
      WHERE name = 'Cancheros'
      LIMIT 1;
    `);

    assert(cancheros.rows.length > 0, "Cancheros exists");
    const cancherosId = cancheros.rows[0].id;

    const gw = await client.query(`
      SELECT id, fpl_id, season_id
      FROM gameweeks
      ORDER BY fpl_id
      LIMIT 1;
    `);

    assert(gw.rows.length > 0, "gameweek exists");
    const gameweek = gw.rows[0];

    const members = await client.query(
      `
      SELECT
        cm.id AS member_id,
        cm.manager_id,
        fm.first_name,
        fm.last_name
      FROM cancheros_members cm
      JOIN fpl_managers fm ON fm.id = cm.manager_id
      WHERE cm.cancheros_id = $1
        AND cm.active = true
      ORDER BY cm.id;
      `,
      [cancherosId]
    );

    assert(members.rows.length >= 2, "need 2 members");

    const [a, b] = members.rows;

    await client.query(
      `
      DELETE FROM manager_gameweek_scores
      WHERE gameweek_id = $1;
      `,
      [gameweek.id]
    );

    await client.query(
      `
      INSERT INTO manager_gameweek_scores (
        manager_id,
        gameweek_id,
        points,
        total_points
      )
      VALUES
        ($1, $3, 81, 81),
        ($2, $3, 72, 72);
      `,
      [a.manager_id, b.manager_id, gameweek.id]
    );

    console.log(
      `\nRecording weekly result for GW${gameweek.fpl_id}...`
    );

    const weekly = await recordWeeklyResult(
      cancherosId,
      gameweek.fpl_id,
      client
    );

    assert(weekly.recorded === true, "weekly recorded");
    assert(weekly.tied === false, "not tied");
    assert(
      weekly.winners.length === 1,
      "one weekly winner"
    );
    assert(
      weekly.winners[0].member_id === a.member_id,
      "A is weekly winner"
    );

    console.log({
      recorded: weekly.recorded,
      tied: weekly.tied,
      winners: weekly.winners.map(label),
    });

    console.log("\nRe-recording weekly (idempotent)...");

    const again = await recordWeeklyResult(
      cancherosId,
      gameweek.fpl_id,
      client
    );

    assert(again.updated === true, "updated existing");
    assert(again.created === false, "not created again");

    const history = await getCompetitionHistory(
      cancherosId,
      "weekly",
      client
    );

    console.log("\n--- Weekly history ---");
    console.table(
      history.flatMap((entry) =>
        entry.winners.map((winner) => ({
          gw: entry.gameweek,
          tied: entry.tied,
          manager: label(winner),
          points: winner.points,
        }))
      )
    );

    assert(history.length === 1, "one history entry");
    assert(
      history[0].winners[0].member_id === a.member_id,
      "history winner matches"
    );
    assert(
      Number(history[0].winners[0].points) === 81,
      "history points preserved"
    );

    /*
     * Joint weekly winners
     */
    await client.query(
      `
      UPDATE manager_gameweek_scores
      SET points = 81
      WHERE manager_id = $1
        AND gameweek_id = $2;
      `,
      [b.manager_id, gameweek.id]
    );

    const tied = await recordWeeklyResult(
      cancherosId,
      gameweek.fpl_id,
      client
    );

    assert(tied.tied === true, "joint weekly winners");
    assert(tied.winners.length === 2, "two winners stored");

    console.log("\nJoint weekly winners:");
    console.log(tied.winners.map(label));

    await client.query("ROLLBACK");

    console.log("\n==============================");
    console.log("HISTORY TEST PASSED");
    console.log("(transaction rolled back)");
    console.log("==============================\n");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("History test failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
