import { pool } from "../config/database.js";
import { processH2HResults } from "../services/competitions/h2h.results.js";

async function run() {
  const client = await pool.connect();

  try {
    console.log("\n==============================");
    console.log("H2H RESULT PROCESSOR TEST");
    console.log("==============================");

    /*
     * Find GW1 H2H round.
     */

    const roundResult = await client.query(`
      SELECT id
      FROM h2h_rounds
      WHERE gameweek_id = (
        SELECT id
        FROM gameweeks
        WHERE fpl_id = 1
        AND season_id = (
          SELECT id
          FROM seasons
          WHERE is_current = true
          LIMIT 1
        )
        LIMIT 1
      )
      LIMIT 1;
    `);

    if (roundResult.rows.length === 0) {
      throw new Error(
        "No H2H round found. Run the lottery first."
      );
    }

    const roundId = roundResult.rows[0].id;

    /*
     * Get matches.
     */

    const matches = await client.query(
      `
      SELECT
        id,
        player_one_id,
        player_two_id,
        is_bye

      FROM h2h_matches

      WHERE round_id = $1

      ORDER BY id;
      `,
      [roundId]
    );

    /*
     * Create fake scores.
     *
     * We deliberately use different scores
     * so we can test win/draw/BYE logic.
     */

    const fakeScores = [81, 72, 65, 65, 90];

    let scoreIndex = 0;

    for (const match of matches.rows) {
      if (match.is_bye) {
        continue;
      }

      const scoreOne =
        fakeScores[scoreIndex++] ?? 70;

      const scoreTwo =
        fakeScores[scoreIndex++] ?? 70;

      /*
       * Find managers belonging to the members.
       */

      const members = await client.query(
        `
        SELECT
          id,
          manager_id

        FROM cancheros_members

        WHERE id = ANY($1::bigint[]);
        `,
        [
          [
            match.player_one_id,
            match.player_two_id,
          ],
        ]
      );

      for (const member of members.rows) {
        const score =
          member.id === match.player_one_id
            ? scoreOne
            : scoreTwo;

        await client.query(
          `
          INSERT INTO manager_gameweek_scores (
            manager_id,
            gameweek_id,
            points,
            total_points,
            overall_rank,
            gameweek_rank,
            bank,
            team_value,
            transfers,
            transfer_cost
          )

          VALUES (
            $1,
            (
              SELECT id
              FROM gameweeks
              WHERE fpl_id = 1
              AND season_id = (
                SELECT id
                FROM seasons
                WHERE is_current = true
                LIMIT 1
              )
            ),
            $2,
            $2,
            0,
            0,
            0,
            1000,
            0,
            0
          )

          ON CONFLICT (
            manager_id,
            gameweek_id
          )

          DO UPDATE SET
            points = EXCLUDED.points;
          `,
          [member.manager_id, score]
        );
      }
    }

    console.log("\nFake scores inserted.");

    /*
     * Process the H2H round.
     */

    const result = await processH2HResults(
      roundId
    );

    console.log("\nProcessing result:");
    console.dir(result, {
      depth: null,
    });

    /*
     * Show final matches.
     */

    const finalMatches = await client.query(
      `
      SELECT
        id,
        player_one_score,
        player_two_score,
        player_one_points,
        player_two_points,
        winner_member_id,
        is_bye,
        completed

      FROM h2h_matches

      WHERE round_id = $1

      ORDER BY id;
      `,
      [roundId]
    );

    console.log("\nFinal H2H matches:");
    console.table(finalMatches.rows);

  }

  catch (error) {
    console.error("\nTest failed:");
    console.error(error);
  }

  finally {
    /*
     * We intentionally leave the fake scores/results
     * for now so we can inspect them.
     *
     * We'll make a rollback version after testing.
     */

    client.release();
    await pool.end();
  }
}

run();