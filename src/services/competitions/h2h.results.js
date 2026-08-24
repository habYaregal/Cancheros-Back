import { pool } from "../../config/database.js";

/**
 * Score / re-score H2H matches for a round.
 *
 * While a gameweek is unfinished, call with refresh=true
 * (default) so provisional FPL points update live.
 *
 * BYEs keep 1.5 points and are never treated as played.
 */
export async function processH2HResults(
  roundId,
  db = pool,
  options = {}
) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const roundResult = await client.query(
      `
      SELECT
        hr.id AS round_id,
        hr.cancheros_id,
        hr.gameweek_id,
        g.fpl_id AS gameweek_fpl_id,
        g.finished AS gameweek_finished

      FROM h2h_rounds hr

      JOIN gameweeks g
        ON g.id = hr.gameweek_id

      WHERE hr.id = $1
      LIMIT 1;
      `,
      [roundId]
    );

    if (roundResult.rows.length === 0) {
      throw new Error(
        `H2H round ${roundId} not found.`
      );
    }

    const round = roundResult.rows[0];

    /*
     * Live GWs always refresh.
     * Finished GWs refresh only when forced
     * (final sync before locking history).
     */
    const refresh =
      options.refresh ?? !round.gameweek_finished;

    const matchesResult = await client.query(
      `
      SELECT
        id,
        player_one_id,
        player_two_id,
        is_bye,
        completed,
        player_one_score,
        player_two_score,
        player_one_points,
        player_two_points,
        winner_member_id

      FROM h2h_matches

      WHERE round_id = $1
        AND (
          $2::boolean = true
          OR completed = false
        )

      ORDER BY id;
      `,
      [roundId, refresh]
    );

    const matches = matchesResult.rows;

    if (matches.length === 0) {
      await client.query("COMMIT");

      return {
        processed: false,
        refreshed: false,
        reason: "No matches to process.",
        roundId,
        gameweek: round.gameweek_fpl_id,
        gameweekFinished: round.gameweek_finished,
      };
    }

    const results = [];
    let changed = 0;

    for (const match of matches) {
      if (match.is_bye) {
        if (
          !match.completed ||
          Number(match.player_one_points) !== 1.5
        ) {
          await client.query(
            `
            UPDATE h2h_matches
            SET
              player_one_points = 1.5,
              player_two_points = 0,
              player_one_score = NULL,
              player_two_score = NULL,
              winner_member_id = NULL,
              completed = true
            WHERE id = $1;
            `,
            [match.id]
          );
          changed += 1;
        }

        results.push({
          matchId: match.id,
          type: "bye",
          playerOnePoints: 1.5,
          playerTwoPoints: 0,
          changed:
            !match.completed ||
            Number(match.player_one_points) !== 1.5,
        });

        continue;
      }

      const playerOneResult = await client.query(
        `
        SELECT mgs.points
        FROM manager_gameweek_scores mgs
        JOIN cancheros_members cm
          ON cm.manager_id = mgs.manager_id
        WHERE cm.id = $1
          AND mgs.gameweek_id = $2
        LIMIT 1;
        `,
        [match.player_one_id, round.gameweek_id]
      );

      const playerTwoResult = await client.query(
        `
        SELECT mgs.points
        FROM manager_gameweek_scores mgs
        JOIN cancheros_members cm
          ON cm.manager_id = mgs.manager_id
        WHERE cm.id = $1
          AND mgs.gameweek_id = $2
        LIMIT 1;
        `,
        [match.player_two_id, round.gameweek_id]
      );

      if (
        playerOneResult.rows.length === 0 ||
        playerTwoResult.rows.length === 0
      ) {
        /*
         * During a live GW, scores may arrive at
         * different times — skip until both exist.
         */
        results.push({
          matchId: match.id,
          type: "pending",
          reason: "Waiting for FPL scores.",
        });
        continue;
      }

      const playerOneScore = Number(
        playerOneResult.rows[0].points
      );
      const playerTwoScore = Number(
        playerTwoResult.rows[0].points
      );

      let playerOnePoints = 0;
      let playerTwoPoints = 0;
      let winnerMemberId = null;

      if (playerOneScore > playerTwoScore) {
        playerOnePoints = 3;
        playerTwoPoints = 0;
        winnerMemberId = match.player_one_id;
      } else if (playerTwoScore > playerOneScore) {
        playerOnePoints = 0;
        playerTwoPoints = 3;
        winnerMemberId = match.player_two_id;
      } else {
        playerOnePoints = 1;
        playerTwoPoints = 1;
        winnerMemberId = null;
      }

      const didChange =
        !match.completed ||
        Number(match.player_one_score) !== playerOneScore ||
        Number(match.player_two_score) !== playerTwoScore ||
        Number(match.player_one_points) !== playerOnePoints ||
        Number(match.player_two_points) !== playerTwoPoints ||
        String(match.winner_member_id || "") !==
          String(winnerMemberId || "");

      if (didChange) {
        await client.query(
          `
          UPDATE h2h_matches
          SET
            player_one_score = $1,
            player_two_score = $2,
            player_one_points = $3,
            player_two_points = $4,
            winner_member_id = $5,
            completed = true
          WHERE id = $6;
          `,
          [
            playerOneScore,
            playerTwoScore,
            playerOnePoints,
            playerTwoPoints,
            winnerMemberId,
            match.id,
          ]
        );
        changed += 1;
      }

      results.push({
        matchId: match.id,
        playerOneScore,
        playerTwoScore,
        playerOnePoints,
        playerTwoPoints,
        winnerMemberId,
        changed: didChange,
        provisional: !round.gameweek_finished,
      });
    }

    await client.query("COMMIT");

    return {
      processed: true,
      refreshed: refresh,
      changed,
      roundId,
      gameweek: round.gameweek_fpl_id,
      gameweekFinished: round.gameweek_finished,
      matchesProcessed: results.length,
      results,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
