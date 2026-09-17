import { pool } from "../../config/database.js";
import { getH2HStandings } from "./h2h.js";

/**
 * Resolve the Cancheros H2H winner(s).
 *
 * Tie order — MATCHES standings sort in h2h.js:
 *   1. Highest H2H points
 *   2. Highest points difference (PG - PL)
 *   3. Most wins
 *   4. Head-to-head among remaining tied players
 *   5. Name (alphabetical last/first)
 *   6. Still tied → joint winners
 */
export async function getH2HWinner(
  cancherosId,
  db = pool
) {
  const standings = await getH2HStandings(
    cancherosId,
    db
  );

  if (standings.length === 0) {
    return {
      cancherosId,
      winner: null,
      winners: [],
      tied: false,
      resolvedBy: null,
      message: "No participants found.",
    };
  }

  const engaged = standings.filter(
    (player) =>
      player.points > 0 || player.played > 0
  );

  if (engaged.length === 0) {
    return {
      cancherosId,
      winner: null,
      winners: [],
      tied: false,
      resolvedBy: null,
      message: "No H2H results available yet.",
    };
  }

  /*
   * --------------------------------------------------
   * 1. Highest points
   * --------------------------------------------------
   */

  const topPoints = engaged[0].points;

  let candidates = engaged.filter(
    (player) => player.points === topPoints
  );

  if (candidates.length === 1) {
    return buildWinnerResult(
      cancherosId,
      candidates,
      "points"
    );
  }

  /*
   * --------------------------------------------------
   * 2. Highest points difference (PG - PL)
   * --------------------------------------------------
   */

  const topPd = Math.max(
    ...candidates.map((player) => player.points_difference)
  );

  candidates = candidates.filter(
    (player) => player.points_difference === topPd
  );

  if (candidates.length === 1) {
    return buildWinnerResult(
      cancherosId,
      candidates,
      "points_difference"
    );
  }

  /*
   * --------------------------------------------------
   * 3. Most wins
   * --------------------------------------------------
   */

  const topWins = Math.max(
    ...candidates.map((player) => player.wins)
  );

  candidates = candidates.filter(
    (player) => player.wins === topWins
  );

  if (candidates.length === 1) {
    return buildWinnerResult(
      cancherosId,
      candidates,
      "wins"
    );
  }

  /*
   * --------------------------------------------------
   * 4. Head-to-head among remaining candidates
   * --------------------------------------------------
   */

  const memberIds = candidates.map(
    (player) => player.member_id
  );

  const headToHeadMatches =
    await getHeadToHeadMatchesAmong(
      cancherosId,
      memberIds,
      db
    );

  const ranked = rankByHeadToHead(
    candidates,
    headToHeadMatches
  );

  const bestMiniPoints = ranked[0].h2h_points;

  candidates = ranked.filter(
    (player) => player.h2h_points === bestMiniPoints
  );

  if (candidates.length === 1) {
    return buildWinnerResult(
      cancherosId,
      candidates,
      "head_to_head"
    );
  }

  /*
   * --------------------------------------------------
   * 5. Name (alphabetical, last_name then first_name)
   * --------------------------------------------------
   */

  candidates.sort((a, b) => {
    const last = String(a.last_name).localeCompare(String(b.last_name));
    if (last !== 0) return last;
    return String(a.first_name).localeCompare(String(b.first_name));
  });

  if (candidates.length === 1) {
    return buildWinnerResult(
      cancherosId,
      candidates,
      "name"
    );
  }

  const firstByAlpha = [candidates[0]];
  const hasUniqueAlpha = candidates.some(
    (p, i) =>
      i > 0 &&
      (String(p.last_name) !== String(candidates[0].last_name) ||
        String(p.first_name) !== String(candidates[0].first_name))
  );
  if (hasUniqueAlpha) {
    return buildWinnerResult(
      cancherosId,
      firstByAlpha,
      "name"
    );
  }

  /*
   * --------------------------------------------------
   * 6. Still tied → joint winners
   * --------------------------------------------------
   */

  return buildWinnerResult(
    cancherosId,
    candidates,
    "joint"
  );
}

/**
 * Completed non-BYE matches where both sides
 * belong to the tied candidate set.
 */
export async function getHeadToHeadMatchesAmong(
  cancherosId,
  memberIds,
  db = pool
) {
  if (memberIds.length < 2) {
    return [];
  }

  const result = await db.query(
    `
    SELECT
      hm.id,
      hm.player_one_id,
      hm.player_two_id,
      hm.player_one_points,
      hm.player_two_points,
      hm.winner_member_id

    FROM h2h_matches hm

    JOIN h2h_rounds hr
      ON hr.id = hm.round_id

    WHERE hr.cancheros_id = $1
      AND hm.completed = true
      AND hm.is_bye = false
      AND hm.player_one_id = ANY($2::bigint[])
      AND hm.player_two_id = ANY($2::bigint[])

    ORDER BY hm.id;
    `,
    [cancherosId, memberIds]
  );

  return result.rows.map((match) => ({
    ...match,
    player_one_points: Number(match.player_one_points),
    player_two_points: Number(match.player_two_points),
  }));
}

/**
 * Mini-league points from matches only involving
 * the tied candidates. Pure / testable.
 */
export function rankByHeadToHead(
  candidates,
  matches
) {
  const mini = new Map(
    candidates.map((player) => [
      player.member_id,
      {
        ...player,
        h2h_points: 0,
        h2h_wins: 0,
      },
    ])
  );

  for (const match of matches) {
    const playerOne = mini.get(match.player_one_id);
    const playerTwo = mini.get(match.player_two_id);

    if (!playerOne || !playerTwo) {
      continue;
    }

    playerOne.h2h_points += Number(
      match.player_one_points
    );
    playerTwo.h2h_points += Number(
      match.player_two_points
    );

    if (Number(match.player_one_points) === 3) {
      playerOne.h2h_wins += 1;
    }

    if (Number(match.player_two_points) === 3) {
      playerTwo.h2h_wins += 1;
    }
  }

  return [...mini.values()].sort((a, b) => {
    if (b.h2h_points !== a.h2h_points) {
      return b.h2h_points - a.h2h_points;
    }

    if (b.h2h_wins !== a.h2h_wins) {
      return b.h2h_wins - a.h2h_wins;
    }

    return a.member_id - b.member_id;
  });
}

function buildWinnerResult(
  cancherosId,
  winners,
  resolvedBy
) {
  const tied =
    winners.length > 1 || resolvedBy === "joint";

  return {
    cancherosId,
    winner: winners.length === 1 ? winners[0] : null,
    winners,
    tied,
    resolvedBy: tied ? "joint" : resolvedBy,
  };
}
