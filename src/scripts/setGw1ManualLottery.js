import { pool } from "../config/database.js";
import { syncCancherosGameweek } from "../services/fpl/fpl.cancheros.sync.js";
import { setManualH2HLottery } from "../services/competitions/h2h.lottery.js";
import { processH2HResults } from "../services/competitions/h2h.results.js";
import { getH2HStandings } from "../services/competitions/h2h.js";

/**
 * Manual GW1 lottery (10 players, no BYE):
 *   habget vs Abrham
 *   Yafet vs Eyob
 *   Negese vs ሀብተማርያም
 *   El bicho vs Henok
 *   Amanuel vs Tinu
 */
const GW1_MANUAL_MATCHUPS = [
  { playerOneFplId: 5547014, playerTwoFplId: 3676616 }, // habget vs Abrham
  { playerOneFplId: 3748518, playerTwoFplId: 8105217 }, // Yafet vs Eyob
  { playerOneFplId: 5483704, playerTwoFplId: 3142173 }, // Negese vs ሀብተማርያም
  { playerOneFplId: 3983444, playerTwoFplId: 5135880 }, // El bicho vs Henok
  { playerOneFplId: 3501226, playerTwoFplId: 8346220 }, // Amanuel vs Tinu
];

function findMemberByFplId(members, fplId) {
  const match = members.find(
    (member) => Number(member.fpl_id) === Number(fplId)
  );

  if (!match) {
    throw new Error(`Could not resolve member for FPL id ${fplId}.`);
  }

  return match;
}

async function run() {
  try {
    console.log("\n==============================");
    console.log("GW1 MANUAL H2H LOTTERY + RESULTS");
    console.log("==============================\n");

    const cancheros = await pool.query(`
      SELECT id
      FROM cancheros
      WHERE name = 'Cancheros'
      LIMIT 1;
    `);

    if (cancheros.rows.length === 0) {
      throw new Error("Cancheros league not found.");
    }

    const cancherosId = cancheros.rows[0].id;

    const gameweek = await pool.query(`
      SELECT id, fpl_id, name
      FROM gameweeks
      WHERE fpl_id = 1
      LIMIT 1;
    `);

    if (gameweek.rows.length === 0) {
      throw new Error("GW1 not found.");
    }

    const gw = gameweek.rows[0];

    console.log("1) Syncing latest GW1 FPL scores...");
    const scores = await syncCancherosGameweek(1);
    console.table(
      (scores.members || []).map((row) => ({
        manager: row.name,
        synced: row.synced,
        points: row.points,
      }))
    );

    const membersResult = await pool.query(
      `
      SELECT
        cm.id AS member_id,
        cm.display_name,
        fm.fpl_id,
        fm.first_name,
        fm.last_name,
        fm.team_name
      FROM cancheros_members cm
      JOIN fpl_managers fm
        ON fm.id = cm.manager_id
      WHERE cm.cancheros_id = $1
        AND cm.active = true;
      `,
      [cancherosId]
    );

    const members = membersResult.rows;

    const pairings = GW1_MANUAL_MATCHUPS.map((pair) => {
      const playerOne = findMemberByFplId(
        members,
        pair.playerOneFplId
      );
      const playerTwo = findMemberByFplId(
        members,
        pair.playerTwoFplId
      );

      return {
        playerOneId: playerOne.member_id,
        playerTwoId: playerTwo.member_id,
        label: `${playerOne.first_name} ${playerOne.last_name} (${playerOne.team_name}) vs ${playerTwo.first_name} ${playerTwo.last_name} (${playerTwo.team_name})`,
      };
    });

    console.log("\n2) Setting manual lottery...");
    pairings.forEach((pair, index) => {
      console.log(`   ${index + 1}. ${pair.label}`);
    });

    const lottery = await setManualH2HLottery(
      cancherosId,
      gw.id,
      pairings.map((pair) => ({
        playerOneId: pair.playerOneId,
        playerTwoId: pair.playerTwoId,
      })),
      { replace: true }
    );

    console.log(
      `\nLottery round ${lottery.roundId} saved ` +
        `(replaced=${lottery.replaced}, matches=${lottery.matches.length})`
    );

    console.log("\n3) Processing H2H results...");
    const results = await processH2HResults(lottery.roundId);
    console.dir(results, { depth: 4 });

    const sheet = await pool.query(
      `
      SELECT
        g.fpl_id AS gameweek,
        hm.id AS match_id,
        hm.is_bye,
        hm.completed,

        fm1.first_name AS p1_first,
        fm1.last_name AS p1_last,
        fm1.team_name AS p1_team,
        hm.player_one_score AS p1_score,
        hm.player_one_points AS p1_h2h,

        fm2.first_name AS p2_first,
        fm2.last_name AS p2_last,
        fm2.team_name AS p2_team,
        hm.player_two_score AS p2_score,
        hm.player_two_points AS p2_h2h,

        CASE
          WHEN hm.is_bye THEN 'BYE'
          WHEN hm.winner_member_id = hm.player_one_id
            THEN fm1.first_name || ' ' || fm1.last_name
          WHEN hm.winner_member_id = hm.player_two_id
            THEN fm2.first_name || ' ' || fm2.last_name
          WHEN hm.completed THEN 'DRAW'
          ELSE 'PENDING'
        END AS result

      FROM h2h_matches hm
      JOIN h2h_rounds hr ON hr.id = hm.round_id
      JOIN gameweeks g ON g.id = hr.gameweek_id
      LEFT JOIN cancheros_members cm1 ON cm1.id = hm.player_one_id
      LEFT JOIN fpl_managers fm1 ON fm1.id = cm1.manager_id
      LEFT JOIN cancheros_members cm2 ON cm2.id = hm.player_two_id
      LEFT JOIN fpl_managers fm2 ON fm2.id = cm2.manager_id
      WHERE hr.id = $1
      ORDER BY hm.id;
      `,
      [lottery.roundId]
    );

    console.log("\n==============================");
    console.log("GW1 H2H SCORESHEET");
    console.log("==============================");
    console.table(
      sheet.rows.map((row) => ({
        fixture: row.is_bye
          ? `${row.p1_first} ${row.p1_last} vs BYE`
          : `${row.p1_first} ${row.p1_last} vs ${row.p2_first} ${row.p2_last}`,
        score: row.is_bye
          ? `${row.p1_h2h}`
          : `${row.p1_score} - ${row.p2_score}`,
        h2h: row.is_bye
          ? `${row.p1_h2h}`
          : `${row.p1_h2h} - ${row.p2_h2h}`,
        result: row.result,
      }))
    );

    const standings = await getH2HStandings(cancherosId);

    console.log("\n==============================");
    console.log("H2H TABLE AFTER GW1");
    console.log("==============================");
    console.table(
      standings.map((row, index) => ({
        pos: index + 1,
        manager: `${row.first_name} ${row.last_name}`,
        team: row.team_name,
        P: row.played,
        W: row.wins,
        D: row.draws,
        L: row.losses,
        Pts: row.points,
      }))
    );

    console.log("\nDone.\n");
  } catch (error) {
    console.error("\nFailed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
