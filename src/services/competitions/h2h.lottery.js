import { pool } from "../../config/database.js";

/**
 * Randomly shuffles an array.
 */
function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/**
 * Creates the H2H round and randomly assigns
 * active Cancheros members to matches.
 *
 * The lottery is permanent once created.
 */
export async function generateH2HLottery(
  cancherosId,
  gameweekId,
  db = pool
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    /*
     * --------------------------------------------------
     * 1. Check whether this round already exists
     * --------------------------------------------------
     */

    const existingRound = await client.query(
      `
      SELECT id
      FROM h2h_rounds
      WHERE cancheros_id = $1
        AND gameweek_id = $2
      LIMIT 1;
      `,
      [cancherosId, gameweekId]
    );

    if (existingRound.rows.length > 0) {
      const roundId = existingRound.rows[0].id;

      const matches = await client.query(
        `
        SELECT *
        FROM h2h_matches
        WHERE round_id = $1
        ORDER BY id;
        `,
        [roundId]
      );

      await client.query("COMMIT");

      return {
        created: false,
        roundId,
        matches: matches.rows,
      };
    }

    /*
     * --------------------------------------------------
     * 2. Get active Cancheros members
     * --------------------------------------------------
     */

    const membersResult = await client.query(
      `
      SELECT
        cm.id AS member_id,
        cm.manager_id,
        cm.display_name,
        fm.first_name,
        fm.last_name,
        fm.team_name

      FROM cancheros_members cm

      JOIN fpl_managers fm
        ON fm.id = cm.manager_id

      WHERE cm.cancheros_id = $1
        AND cm.active = true
        AND cm.participation_start_gw <= (
          SELECT fpl_id
          FROM gameweeks
          WHERE id = $2
        )

      ORDER BY cm.id;
      `,
      [cancherosId, gameweekId]
    );

    const members = membersResult.rows;

    if (members.length === 0) {
      throw new Error(
        "No active Cancheros members found for this gameweek."
      );
    }

    /*
     * --------------------------------------------------
     * 3. Create the round
     * --------------------------------------------------
     */

    const roundResult = await client.query(
      `
      INSERT INTO h2h_rounds (
        cancheros_id,
        gameweek_id
      )
      VALUES ($1, $2)
      RETURNING id;
      `,
      [cancherosId, gameweekId]
    );

    const roundId = roundResult.rows[0].id;

    /*
     * --------------------------------------------------
     * 4. Shuffle the members
     * --------------------------------------------------
     */

    const shuffledMembers = shuffle(members);

    /*
     * --------------------------------------------------
     * 5. Create matches
     * --------------------------------------------------
     */

    const matches = [];

    for (let i = 0; i < shuffledMembers.length; i += 2) {
      const playerOne = shuffledMembers[i];
      const playerTwo = shuffledMembers[i + 1] || null;

      /*
       * Normal match
       */
      if (playerTwo) {
        const result = await client.query(
          `
          INSERT INTO h2h_matches (
            round_id,
            player_one_id,
            player_two_id,
            is_bye
          )
          VALUES ($1, $2, $3, false)
          RETURNING *;
          `,
          [
            roundId,
            playerOne.member_id,
            playerTwo.member_id,
          ]
        );

        matches.push(result.rows[0]);
      }

      /*
       * Odd-number player gets a BYE.
       */
      else {
        const result = await client.query(
          `
          INSERT INTO h2h_matches (
            round_id,
            player_one_id,
            player_two_id,
            player_one_points,
            player_two_points,
            is_bye,
            completed
          )
          VALUES (
            $1,
            $2,
            NULL,
            1.5,
            0,
            true,
            true
          )
          RETURNING *;
          `,
          [
            roundId,
            playerOne.member_id,
          ]
        );

        matches.push(result.rows[0]);
      }
    }

    await client.query("COMMIT");

    return {
      created: true,
      roundId,
      matches,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Save an explicit H2H draw for a gameweek.
 *
 * pairings: [{ playerOneId, playerTwoId|null }]
 * Use playerTwoId = null for a BYE.
 *
 * replace: true deletes any existing round/matches
 * for that gameweek first (manual override).
 */
export async function setManualH2HLottery(
  cancherosId,
  gameweekId,
  pairings,
  options = {},
  db = pool
) {
  const { replace = false } = options;
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    if (!Array.isArray(pairings) || pairings.length === 0) {
      throw new Error("Manual lottery requires at least one pairing.");
    }

    const existingRound = await client.query(
      `
      SELECT id
      FROM h2h_rounds
      WHERE cancheros_id = $1
        AND gameweek_id = $2
      LIMIT 1;
      `,
      [cancherosId, gameweekId]
    );

    let replaced = false;
    let roundId;

    if (existingRound.rows.length > 0) {
      if (!replace) {
        throw new Error(
          "H2H round already exists for this gameweek. Pass replace: true to override."
        );
      }

      roundId = existingRound.rows[0].id;
      replaced = true;

      await client.query(
        `
        DELETE FROM h2h_matches
        WHERE round_id = $1;
        `,
        [roundId]
      );
    } else {
      const roundResult = await client.query(
        `
        INSERT INTO h2h_rounds (
          cancheros_id,
          gameweek_id
        )
        VALUES ($1, $2)
        RETURNING id;
        `,
        [cancherosId, gameweekId]
      );

      roundId = roundResult.rows[0].id;
    }

    const seen = new Set();
    const matches = [];

    for (const pairing of pairings) {
      const playerOneId = pairing.playerOneId;
      const playerTwoId = pairing.playerTwoId ?? null;

      if (!playerOneId) {
        throw new Error("Each pairing needs playerOneId.");
      }

      if (seen.has(playerOneId)) {
        throw new Error(
          `Member ${playerOneId} appears more than once in the lottery.`
        );
      }

      seen.add(playerOneId);

      if (playerTwoId) {
        if (seen.has(playerTwoId)) {
          throw new Error(
            `Member ${playerTwoId} appears more than once in the lottery.`
          );
        }

        seen.add(playerTwoId);

        const result = await client.query(
          `
          INSERT INTO h2h_matches (
            round_id,
            player_one_id,
            player_two_id,
            is_bye,
            completed
          )
          VALUES ($1, $2, $3, false, false)
          RETURNING *;
          `,
          [roundId, playerOneId, playerTwoId]
        );

        matches.push(result.rows[0]);
      } else {
        const result = await client.query(
          `
          INSERT INTO h2h_matches (
            round_id,
            player_one_id,
            player_two_id,
            player_one_points,
            player_two_points,
            is_bye,
            completed
          )
          VALUES ($1, $2, NULL, 1.5, 0, true, true)
          RETURNING *;
          `,
          [roundId, playerOneId]
        );

        matches.push(result.rows[0]);
      }
    }

    await client.query("COMMIT");

    return {
      created: !replaced,
      replaced,
      roundId,
      matches,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
