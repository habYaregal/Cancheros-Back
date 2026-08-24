import { pool } from "../../config/database.js";
import { generateH2HLottery } from "./h2h.lottery.js";

/**
 * Draw is allowed only after a gameweek has finished,
 * and only for the next gameweek if it has no lottery yet.
 */
export async function getH2HDrawStatus(
  cancherosId,
  db = pool
) {
  const finished = await db.query(`
    SELECT id, fpl_id, name, finished
    FROM gameweeks
    WHERE finished = true
    ORDER BY fpl_id DESC
    LIMIT 1;
  `);

  if (finished.rows.length === 0) {
    return {
      canDraw: false,
      reason:
        "Available after a gameweek finishes.",
      previousGameweek: null,
      targetGameweek: null,
      alreadyDrawn: false,
    };
  }

  const previous = finished.rows[0];
  const nextFplId = Number(previous.fpl_id) + 1;

  const next = await db.query(
    `
    SELECT id, fpl_id, name, finished, is_current
    FROM gameweeks
    WHERE fpl_id = $1
    LIMIT 1;
    `,
    [nextFplId]
  );

  if (next.rows.length === 0) {
    return {
      canDraw: false,
      reason: `No gameweek ${nextFplId} found yet.`,
      previousGameweek: mapGw(previous),
      targetGameweek: null,
      alreadyDrawn: false,
    };
  }

  const target = next.rows[0];

  const existing = await db.query(
    `
    SELECT id
    FROM h2h_rounds
    WHERE cancheros_id = $1
      AND gameweek_id = $2
    LIMIT 1;
    `,
    [cancherosId, target.id]
  );

  if (existing.rows.length > 0) {
    return {
      canDraw: false,
      reason: `GW${target.fpl_id} lottery already drawn.`,
      previousGameweek: mapGw(previous),
      targetGameweek: mapGw(target),
      alreadyDrawn: true,
      roundId: existing.rows[0].id,
    };
  }

  return {
    canDraw: true,
    reason: `GW${previous.fpl_id} finished — draw GW${target.fpl_id}.`,
    previousGameweek: mapGw(previous),
    targetGameweek: mapGw(target),
    alreadyDrawn: false,
  };
}

export async function drawNextH2HLottery(
  cancherosId,
  db = pool
) {
  const status = await getH2HDrawStatus(cancherosId, db);

  if (!status.canDraw) {
    const error = new Error(status.reason);
    error.status = 400;
    error.drawStatus = status;
    throw error;
  }

  const lottery = await generateH2HLottery(
    cancherosId,
    status.targetGameweek.id,
    db
  );

  const matches = await db.query(
    `
    SELECT
      hm.id,
      hm.is_bye,
      hm.completed,
      fm1.first_name AS p1_first,
      fm1.last_name AS p1_last,
      fm1.team_name AS p1_team,
      fm2.first_name AS p2_first,
      fm2.last_name AS p2_last,
      fm2.team_name AS p2_team
    FROM h2h_matches hm
    LEFT JOIN cancheros_members cm1 ON cm1.id = hm.player_one_id
    LEFT JOIN fpl_managers fm1 ON fm1.id = cm1.manager_id
    LEFT JOIN cancheros_members cm2 ON cm2.id = hm.player_two_id
    LEFT JOIN fpl_managers fm2 ON fm2.id = cm2.manager_id
    WHERE hm.round_id = $1
    ORDER BY hm.id;
    `,
    [lottery.roundId]
  );

  return {
    created: lottery.created,
    roundId: lottery.roundId,
    previousGameweek: status.previousGameweek,
    gameweek: status.targetGameweek,
    matchCount: matches.rows.length,
    matches: matches.rows.map((row) => ({
      matchId: row.id,
      isBye: row.is_bye,
      completed: row.completed,
      playerOne: `${row.p1_first} ${row.p1_last}`,
      teamOne: row.p1_team,
      playerTwo: row.is_bye
        ? "BYE"
        : `${row.p2_first} ${row.p2_last}`,
      teamTwo: row.is_bye ? null : row.p2_team,
    })),
    message: lottery.created
      ? `H2H lottery created for GW${status.targetGameweek.fplId}.`
      : `H2H lottery already exists for GW${status.targetGameweek.fplId}.`,
  };
}

function mapGw(row) {
  if (!row) return null;

  return {
    id: row.id,
    fplId: row.fpl_id,
    name: row.name,
    finished: row.finished,
    isCurrent: row.is_current ?? false,
  };
}
