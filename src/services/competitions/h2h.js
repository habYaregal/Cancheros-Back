import { pool } from "../../config/database.js";

/**
 * Season H2H table for active Cancheros members.
 *
 * BYE awards 1.5 points but does not count as
 * a played match (and never as a win/draw/loss).
 *
 * Tiebreaker order:
 *   1. Points (highest)
 *   2. Points difference PG - PL (highest)
 *   3. Wins (most)
 *   4. Name (alphabetical)
 */
export async function getH2HStandings(
  cancherosId,
  db = pool
) {
  const matchesResult = await db.query(
    `
    SELECT
      cm.id AS member_id,
      hm.player_one_id,
      hm.player_two_id,
      hm.player_one_score,
      hm.player_two_score,
      hm.player_one_points,
      hm.player_two_points,
      hm.is_bye,
      hm.completed
    FROM cancheros_members cm
    JOIN h2h_rounds hr
      ON hr.cancheros_id = cm.cancheros_id
    JOIN h2h_matches hm
      ON hm.round_id = hr.id
      AND hm.completed = true
      AND (
        hm.player_one_id = cm.id
        OR hm.player_two_id = cm.id
      )
    WHERE
      cm.cancheros_id = $1
      AND cm.active = true;
    `,
    [cancherosId]
  );

  const memberStats = new Map();
  for (const row of matchesResult.rows) {
    if (!memberStats.has(row.member_id)) {
      memberStats.set(row.member_id, {
        points: 0,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points_gained: 0,
        points_lost: 0,
      });
    }
    const s = memberStats.get(row.member_id);

    if (row.is_bye) {
      if (row.player_one_id === row.member_id) {
        s.points += Number(row.player_one_points) || 0;
      }
      if (row.player_two_id === row.member_id) {
        s.points += Number(row.player_two_points) || 0;
      }
      continue;
    }

    const side =
      row.player_one_id === row.member_id ? "one" : "two";
    const myPoints =
      side === "one"
        ? Number(row.player_one_points)
        : Number(row.player_two_points);

    s.points += myPoints;
    s.played += 1;

    const myScore =
      side === "one"
        ? Number(row.player_one_score)
        : Number(row.player_two_score);
    const oppScore =
      side === "one"
        ? Number(row.player_two_score)
        : Number(row.player_one_score);

    const gained = Math.max(myScore - oppScore, 0);
    const lost = Math.max(oppScore - myScore, 0);
    s.points_gained += gained;
    s.points_lost += lost;

    if (myPoints === 3) {
      s.wins += 1;
    } else if (myPoints === 1) {
      s.draws += 1;
    } else if (myPoints === 0) {
      s.losses += 1;
    }
  }

  const membersResult = await db.query(
    `
    SELECT
      cm.id AS member_id,
      fm.fpl_id,
      fm.first_name,
      fm.last_name,
      fm.team_name
    FROM cancheros_members cm
    JOIN fpl_managers fm ON fm.id = cm.manager_id
    WHERE cm.cancheros_id = $1 AND cm.active = true
    ORDER BY fm.last_name ASC, fm.first_name ASC;
    `,
    [cancherosId]
  );

  const rows = membersResult.rows.map((m) => {
    const s = memberStats.get(m.member_id) || {
      points: 0,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points_gained: 0,
      points_lost: 0,
    };

    const pointsGained = Number(s.points_gained) || 0;
    const pointsLost = Number(s.points_lost) || 0;

    return {
      member_id: m.member_id,
      fpl_id: m.fpl_id,
      first_name: m.first_name,
      last_name: m.last_name,
      team_name: m.team_name,
      points: Number(s.points) || 0,
      played: Number(s.played) || 0,
      wins: Number(s.wins) || 0,
      draws: Number(s.draws) || 0,
      losses: Number(s.losses) || 0,
      points_gained: pointsGained,
      points_lost: pointsLost,
      points_difference: pointsGained - pointsLost,
    };
  });

  rows.sort((a, b) => {
    const aPts = Number(a.points) || 0;
    const bPts = Number(b.points) || 0;
    if (bPts > aPts) return 1;
    if (bPts < aPts) return -1;

    const aPd = Number(a.points_difference) || 0;
    const bPd = Number(b.points_difference) || 0;
    if (bPd > aPd) return 1;
    if (bPd < aPd) return -1;

    const aWins = Number(a.wins) || 0;
    const bWins = Number(b.wins) || 0;
    if (bWins > aWins) return 1;
    if (bWins < aWins) return -1;

    const last = String(a.last_name).localeCompare(String(b.last_name));
    if (last !== 0) return last;
    return String(a.first_name).localeCompare(String(b.first_name));
  });

  return rows;
}
