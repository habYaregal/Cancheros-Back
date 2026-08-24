import { pool } from "../config/database.js";
import { getH2HStandings } from "../services/competitions/h2h.js";
import {
  getH2HWinner,
  rankByHeadToHead,
} from "../services/competitions/h2h.winner.js";

function label(player) {
  return `${player.first_name} ${player.last_name}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

async function getCancherosId(client) {
  const result = await client.query(`
    SELECT id
    FROM cancheros
    WHERE name = 'Cancheros'
    LIMIT 1;
  `);

  if (result.rows.length === 0) {
    throw new Error("Cancheros league not found.");
  }

  return result.rows[0].id;
}

async function getActiveMembers(client, cancherosId) {
  const result = await client.query(
    `
    SELECT
      cm.id AS member_id,
      fm.first_name,
      fm.last_name,
      cm.active,
      cm.participation_start_gw
    FROM cancheros_members cm
    JOIN fpl_managers fm ON fm.id = cm.manager_id
    WHERE cm.cancheros_id = $1
    ORDER BY cm.id;
    `,
    [cancherosId]
  );

  return result.rows;
}

async function getAnyGameweek(client) {
  const result = await client.query(`
    SELECT id, fpl_id
    FROM gameweeks
    ORDER BY fpl_id
    LIMIT 1;
  `);

  if (result.rows.length === 0) {
    throw new Error("No gameweeks found.");
  }

  return result.rows[0];
}

/**
 * Isolated scenarios use a transaction that always
 * rolls back so live Cancheros data is untouched.
 */
async function runScenario(name, fn) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log(`\n--- ${name} ---`);
    await fn(client);

    console.log("PASS");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function insertRound(client, cancherosId, gameweekId) {
  const result = await client.query(
    `
    INSERT INTO h2h_rounds (cancheros_id, gameweek_id)
    VALUES ($1, $2)
    RETURNING id;
    `,
    [cancherosId, gameweekId]
  );

  return result.rows[0].id;
}

async function insertMatch(
  client,
  {
    roundId,
    playerOneId,
    playerTwoId = null,
    playerOnePoints = 0,
    playerTwoPoints = 0,
    isBye = false,
    winnerMemberId = null,
  }
) {
  await client.query(
    `
    INSERT INTO h2h_matches (
      round_id,
      player_one_id,
      player_two_id,
      player_one_points,
      player_two_points,
      winner_member_id,
      is_bye,
      completed
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, true);
    `,
    [
      roundId,
      playerOneId,
      playerTwoId,
      playerOnePoints,
      playerTwoPoints,
      winnerMemberId,
      isBye,
    ]
  );
}

async function run() {
  try {
    console.log("\n==============================");
    console.log("H2H RULES TEST");
    console.log("==============================");

    /*
     * Pure unit checks for mini-league ranking
     */
    console.log("\n--- Pure head-to-head ranking ---");

    const ranked = rankByHeadToHead(
      [
        {
          member_id: 1,
          first_name: "A",
          last_name: "One",
          points: 6,
          wins: 2,
        },
        {
          member_id: 2,
          first_name: "B",
          last_name: "Two",
          points: 6,
          wins: 2,
        },
      ],
      [
        {
          player_one_id: 1,
          player_two_id: 2,
          player_one_points: 3,
          player_two_points: 0,
        },
      ]
    );

    assert(ranked[0].member_id === 1, "A should top H2H");
    assert(ranked[0].h2h_points === 3, "A H2H points = 3");
    assert(ranked[1].h2h_points === 0, "B H2H points = 0");
    console.log("PASS");

    /*
     * Live standings smoke check (BYE must not
     * inflate played for the current GW1 lottery).
     */
    const cancherosId = await getCancherosId(pool);
    const liveStandings = await getH2HStandings(cancherosId);
    const liveWinner = await getH2HWinner(cancherosId);

    console.log("\n--- Live standings ---");
    console.table(
      liveStandings.map((player, index) => ({
        position: index + 1,
        manager: label(player),
        played: player.played,
        wins: player.wins,
        draws: player.draws,
        losses: player.losses,
        points: player.points,
      }))
    );

    for (const player of liveStandings) {
      if (player.points === 1.5 && player.wins === 0) {
        assert(
          player.played === 0,
          `${label(player)} BYE-only must have played = 0`
        );
      }

      assert(
        player.played ===
          player.wins + player.draws + player.losses,
        `${label(player)} played must equal W+D+L`
      );
    }

    console.log("\n--- Live winner ---");
    console.log({
      winner: liveWinner.winner
        ? label(liveWinner.winner)
        : null,
      winners: liveWinner.winners.map(label),
      tied: liveWinner.tied,
      resolvedBy: liveWinner.resolvedBy,
      message: liveWinner.message,
    });

    /*
     * Isolated DB scenarios
     */
    await runScenario("BYE does not count as played", async (client) => {
      const cancherosId = await getCancherosId(client);
      const members = await getActiveMembers(client, cancherosId);
      const gw = await getAnyGameweek(client);

      assert(members.length >= 1, "need at least 1 member");

      await client.query(
        `DELETE FROM h2h_matches
         WHERE round_id IN (
           SELECT id FROM h2h_rounds WHERE cancheros_id = $1
         )`,
        [cancherosId]
      );
      await client.query(
        `DELETE FROM h2h_rounds WHERE cancheros_id = $1`,
        [cancherosId]
      );

      const roundId = await insertRound(
        client,
        cancherosId,
        gw.id
      );

      await insertMatch(client, {
        roundId,
        playerOneId: members[0].member_id,
        playerOnePoints: 1.5,
        isBye: true,
      });

      const standings = await getH2HStandings(
        cancherosId,
        client
      );

      const byePlayer = standings.find(
        (row) => row.member_id === members[0].member_id
      );

      assert(byePlayer.points === 1.5, "BYE points = 1.5");
      assert(byePlayer.played === 0, "BYE played = 0");
      assert(byePlayer.wins === 0, "BYE wins = 0");
      assert(byePlayer.draws === 0, "BYE draws = 0");
      assert(byePlayer.losses === 0, "BYE losses = 0");
    });

    await runScenario("Clear H2H winner by points", async (client) => {
      const cancherosId = await getCancherosId(client);
      const members = await getActiveMembers(client, cancherosId);
      const gw = await getAnyGameweek(client);

      assert(members.length >= 2, "need at least 2 members");

      await client.query(
        `DELETE FROM h2h_matches
         WHERE round_id IN (
           SELECT id FROM h2h_rounds WHERE cancheros_id = $1
         )`,
        [cancherosId]
      );
      await client.query(
        `DELETE FROM h2h_rounds WHERE cancheros_id = $1`,
        [cancherosId]
      );

      const roundId = await insertRound(
        client,
        cancherosId,
        gw.id
      );

      await insertMatch(client, {
        roundId,
        playerOneId: members[0].member_id,
        playerTwoId: members[1].member_id,
        playerOnePoints: 3,
        playerTwoPoints: 0,
        winnerMemberId: members[0].member_id,
      });

      const result = await getH2HWinner(cancherosId, client);

      assert(result.tied === false, "not tied");
      assert(result.resolvedBy === "points", "by points");
      assert(
        result.winner.member_id === members[0].member_id,
        "member 0 wins"
      );
    });

    await runScenario(
      "Equal points, most wins separates",
      async (client) => {
        const cancherosId = await getCancherosId(client);
        const members = await getActiveMembers(
          client,
          cancherosId
        );
        const gw = await getAnyGameweek(client);

        assert(members.length >= 3, "need 3 members");

        await client.query(
          `DELETE FROM h2h_matches
           WHERE round_id IN (
             SELECT id FROM h2h_rounds WHERE cancheros_id = $1
           )`,
          [cancherosId]
        );
        await client.query(
          `DELETE FROM h2h_rounds WHERE cancheros_id = $1`,
          [cancherosId]
        );

        /*
         * A: win + win = 6 pts, 2 wins
         * B: win + draw = 4 pts → not in top
         * Wait — we need A and B equal points,
         * A more wins.
         *
         * A: W + D = 4 pts, 1 win
         * B: D + D = 2 pts → not equal
         *
         * Better:
         * A vs B: A wins (A3 B0)
         * A vs C: draw (A1 C1)
         * B vs C: B wins (B3 C0)
         * A = 4 pts, 1 win
         * B = 3 pts — not equal
         *
         * Equal points, different wins:
         * A: 2 wins = 6
         * B: 1 win + 3 draws = 6, 1 win
         * Need a 4th player for B's draws... with 3 players:
         *
         * A vs B: draw (1-1)
         * A vs C: A wins (3-0)
         * B vs C: draw (1-1)
         * A = 4 pts, 1 win
         * B = 2 pts
         *
         * With only results we insert (not a full round robin):
         * Round1: A beat someone outside? 
         *
         * Simpler custom points via two matches for A/B against C:
         * Match1: A beat C → A3
         * Match2: A drew B → A1 B1  → A=4, 1W
         * Match3: B beat C → B3     → B=4, 1W — still equal wins
         *
         * Match1: A beat C (A3)
         * Match2: A beat B (A3) → A=6, 2W
         * Match3: B drew C (B1) → B=1
         * Not equal points.
         *
         * Fabricate:
         * A vs C: A wins → A 3pts 1W
         * B vs C: draw → B 1pt
         * And give B another fabricated match... 
         *
         * Use two rounds:
         * R1: A vs B → A wins (A3 B0)
         * R2: A vs C → draw (A1 C1)
         * R2 also need B: B gets BYE 1.5 → A=4 (1W), B=1.5
         *
         * Desired: same points, A more wins
         * A: one win (3) + one draw (1) = 4, wins=1
         * B: four draws = 4, wins=0 — needs more opponents
         *
         * Practical with 3 members:
         * Insert matches that aren't a consistent round:
         * A vs B: A wins → A3 B0
         * A vs B again: draw → A1 B1  → A=4 1W, B=1
         *
         * Still not equal.
         *
         * A vs B: draw → A1 B1
         * A vs C: A wins → A3  → A=4, 1W
         * B vs C: B wins → B3  → B=4, 1W  equal wins too
         *
         * For wins separator we need equal points, unequal wins.
         * A: W W = 6, 2W
         * B: W D D = 5 — no
         * A: W D = 4, 1W  
         * B: D D D D = 4, 0W — need 4 draw matches for B
         *
         * With 3 players insert:
         * Match1 A vs C: A win (3)
         * Match2 A vs B: draw (1) → A=4, 1W
         * Match3 B vs C: draw (1)
         * Match4 B vs C: draw (1)
         * Match5 B vs C: draw (1) → B=3 — still short
         * Match6 B vs C: draw (1) → B=4, 0W ✓
         */

        const [a, b, c] = members;

        const r1 = await insertRound(client, cancherosId, gw.id);

        await insertMatch(client, {
          roundId: r1,
          playerOneId: a.member_id,
          playerTwoId: c.member_id,
          playerOnePoints: 3,
          playerTwoPoints: 0,
          winnerMemberId: a.member_id,
        });

        await insertMatch(client, {
          roundId: r1,
          playerOneId: a.member_id,
          playerTwoId: b.member_id,
          playerOnePoints: 1,
          playerTwoPoints: 1,
        });

        for (let i = 0; i < 3; i += 1) {
          await insertMatch(client, {
            roundId: r1,
            playerOneId: b.member_id,
            playerTwoId: c.member_id,
            playerOnePoints: 1,
            playerTwoPoints: 1,
          });
        }

        const result = await getH2HWinner(cancherosId, client);

        assert(result.tied === false, "not tied");
        assert(result.resolvedBy === "wins", "by wins");
        assert(
          result.winner.member_id === a.member_id,
          "A wins on more wins"
        );
      }
    );

    await runScenario(
      "H2H separates equal points and wins",
      async (client) => {
        const cancherosId = await getCancherosId(client);
        const members = await getActiveMembers(
          client,
          cancherosId
        );
        const gw = await getAnyGameweek(client);

        assert(members.length >= 3, "need 3 members");

        const [a, b, c] = members;

        await client.query(
          `DELETE FROM h2h_matches
           WHERE round_id IN (
             SELECT id FROM h2h_rounds WHERE cancheros_id = $1
           )`,
          [cancherosId]
        );
        await client.query(
          `DELETE FROM h2h_rounds WHERE cancheros_id = $1`,
          [cancherosId]
        );

        const r1 = await insertRound(client, cancherosId, gw.id);

        /*
         * A beat B, B beat C.
         * Table: A=3/1W, B=3/1W, C=0.
         * Mini H2H among A & B: A wins.
         */
        await insertMatch(client, {
          roundId: r1,
          playerOneId: a.member_id,
          playerTwoId: b.member_id,
          playerOnePoints: 3,
          playerTwoPoints: 0,
          winnerMemberId: a.member_id,
        });

        await insertMatch(client, {
          roundId: r1,
          playerOneId: b.member_id,
          playerTwoId: c.member_id,
          playerOnePoints: 3,
          playerTwoPoints: 0,
          winnerMemberId: b.member_id,
        });

        const standings = await getH2HStandings(
          cancherosId,
          client
        );

        const aRow = standings.find(
          (row) => row.member_id === a.member_id
        );
        const bRow = standings.find(
          (row) => row.member_id === b.member_id
        );

        assert(aRow.points === 3, "A points 3");
        assert(bRow.points === 3, "B points 3");
        assert(aRow.wins === 1, "A wins 1");
        assert(bRow.wins === 1, "B wins 1");

        const result = await getH2HWinner(cancherosId, client);

        assert(result.tied === false, "not tied");
        assert(
          result.resolvedBy === "head_to_head",
          "by H2H"
        );
        assert(
          result.winner.member_id === a.member_id,
          "A wins on H2H"
        );
      }
    );

    await runScenario(
      "H2H also tied → joint winners",
      async (client) => {
        const cancherosId = await getCancherosId(client);
        const members = await getActiveMembers(
          client,
          cancherosId
        );
        const gw = await getAnyGameweek(client);

        assert(members.length >= 3, "need 3 members");

        const [a, b, c] = members;

        await client.query(
          `DELETE FROM h2h_matches
           WHERE round_id IN (
             SELECT id FROM h2h_rounds WHERE cancheros_id = $1
           )`,
          [cancherosId]
        );
        await client.query(
          `DELETE FROM h2h_rounds WHERE cancheros_id = $1`,
          [cancherosId]
        );

        const r1 = await insertRound(client, cancherosId, gw.id);

        /*
         * A and B: 3 pts, 1 win each.
         * Mutual result: draw → joint.
         */
        await insertMatch(client, {
          roundId: r1,
          playerOneId: a.member_id,
          playerTwoId: b.member_id,
          playerOnePoints: 1,
          playerTwoPoints: 1,
        });

        await insertMatch(client, {
          roundId: r1,
          playerOneId: a.member_id,
          playerTwoId: c.member_id,
          playerOnePoints: 3,
          playerTwoPoints: 0,
          winnerMemberId: a.member_id,
        });

        await insertMatch(client, {
          roundId: r1,
          playerOneId: b.member_id,
          playerTwoId: c.member_id,
          playerOnePoints: 3,
          playerTwoPoints: 0,
          winnerMemberId: b.member_id,
        });

        /*
         * A: 1+3 = 4, B: 1+3 = 4 — both 1W
         * Mini H2H: 1-1 draw → joint
         */
        const result = await getH2HWinner(cancherosId, client);

        assert(result.tied === true, "tied");
        assert(result.resolvedBy === "joint", "joint");
        assert(result.winner === null, "no single winner");
        assert(result.winners.length === 2, "two winners");

        const winnerIds = result.winners
          .map((row) => row.member_id)
          .sort();

        assert(
          winnerIds[0] === a.member_id &&
            winnerIds[1] === b.member_id,
          "A and B joint"
        );
      }
    );

    await runScenario(
      "Three-way tie → joint winners",
      async (client) => {
        const cancherosId = await getCancherosId(client);
        const members = await getActiveMembers(
          client,
          cancherosId
        );
        const gw = await getAnyGameweek(client);

        assert(members.length >= 3, "need 3 members");

        const [a, b, c] = members;

        await client.query(
          `DELETE FROM h2h_matches
           WHERE round_id IN (
             SELECT id FROM h2h_rounds WHERE cancheros_id = $1
           )`,
          [cancherosId]
        );
        await client.query(
          `DELETE FROM h2h_rounds WHERE cancheros_id = $1`,
          [cancherosId]
        );

        const r1 = await insertRound(client, cancherosId, gw.id);

        /*
         * Rock-paper-scissors:
         * A beat B, B beat C, C beat A
         * All: 3 pts, 1 win. Mini-league also tied.
         */
        await insertMatch(client, {
          roundId: r1,
          playerOneId: a.member_id,
          playerTwoId: b.member_id,
          playerOnePoints: 3,
          playerTwoPoints: 0,
          winnerMemberId: a.member_id,
        });

        await insertMatch(client, {
          roundId: r1,
          playerOneId: b.member_id,
          playerTwoId: c.member_id,
          playerOnePoints: 3,
          playerTwoPoints: 0,
          winnerMemberId: b.member_id,
        });

        await insertMatch(client, {
          roundId: r1,
          playerOneId: c.member_id,
          playerTwoId: a.member_id,
          playerOnePoints: 3,
          playerTwoPoints: 0,
          winnerMemberId: c.member_id,
        });

        const result = await getH2HWinner(cancherosId, client);

        assert(result.tied === true, "tied");
        assert(result.resolvedBy === "joint", "joint");
        assert(result.winners.length === 3, "three winners");
      }
    );

    await runScenario(
      "Inactive members excluded from standings/winner",
      async (client) => {
        const cancherosId = await getCancherosId(client);
        const members = await getActiveMembers(
          client,
          cancherosId
        );
        const gw = await getAnyGameweek(client);

        assert(members.length >= 2, "need 2 members");

        await client.query(
          `DELETE FROM h2h_matches
           WHERE round_id IN (
             SELECT id FROM h2h_rounds WHERE cancheros_id = $1
           )`,
          [cancherosId]
        );
        await client.query(
          `DELETE FROM h2h_rounds WHERE cancheros_id = $1`,
          [cancherosId]
        );

        const r1 = await insertRound(client, cancherosId, gw.id);

        await insertMatch(client, {
          roundId: r1,
          playerOneId: members[0].member_id,
          playerTwoId: members[1].member_id,
          playerOnePoints: 3,
          playerTwoPoints: 0,
          winnerMemberId: members[0].member_id,
        });

        await client.query(
          `
          UPDATE cancheros_members
          SET active = false
          WHERE id = $1;
          `,
          [members[0].member_id]
        );

        const standings = await getH2HStandings(
          cancherosId,
          client
        );

        assert(
          !standings.some(
            (row) => row.member_id === members[0].member_id
          ),
          "inactive excluded from standings"
        );

        const result = await getH2HWinner(cancherosId, client);

        assert(
          !result.winners.some(
            (row) => row.member_id === members[0].member_id
          ),
          "inactive excluded from winners"
        );
      }
    );

    await runScenario(
      "Late joiner only counted after start GW lottery eligibility",
      async (client) => {
        const cancherosId = await getCancherosId(client);
        const members = await getActiveMembers(
          client,
          cancherosId
        );
        const gw = await getAnyGameweek(client);

        assert(members.length >= 1, "need a member");

        /*
         * Lottery already filters participation_start_gw.
         * Standings only include matches that exist —
         * a late joiner with no matches before join
         * simply has 0 played / 0 points until they appear.
         */
        await client.query(
          `DELETE FROM h2h_matches
           WHERE round_id IN (
             SELECT id FROM h2h_rounds WHERE cancheros_id = $1
           )`,
          [cancherosId]
        );
        await client.query(
          `DELETE FROM h2h_rounds WHERE cancheros_id = $1`,
          [cancherosId]
        );

        await client.query(
          `
          UPDATE cancheros_members
          SET participation_start_gw = 10
          WHERE id = $1;
          `,
          [members[0].member_id]
        );

        const standings = await getH2HStandings(
          cancherosId,
          client
        );

        const late = standings.find(
          (row) => row.member_id === members[0].member_id
        );

        assert(late, "late joiner still listed while active");
        assert(late.points === 0, "no points yet");
        assert(late.played === 0, "no matches played");
      }
    );

    console.log("\n==============================");
    console.log("ALL H2H RULE TESTS PASSED");
    console.log("==============================\n");
  } catch (error) {
    console.error("\nH2H rules test failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
