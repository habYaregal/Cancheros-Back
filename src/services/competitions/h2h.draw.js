import { pool } from "../../config/database.js";
import { generateH2HLottery } from "./h2h.lottery.js";
import { notifyH2HDraw } from "../../telegram/notifications.js";

const DRAW_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Draw is allowed only after a gameweek has finished,
 * only for the next gameweek if it has no lottery yet,
 * and only within 24 hours of that gameweek's deadline.
 */
export async function getH2HDrawStatus(
  cancherosId,
  db = pool,
  now = new Date()
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
      pendingDraw: false,
      reason:
        "Available after a gameweek finishes.",
      previousGameweek: null,
      targetGameweek: null,
      alreadyDrawn: false,
      drawOpensAt: null,
    };
  }

  const previous = finished.rows[0];
  const nextFplId = Number(previous.fpl_id) + 1;

  const next = await db.query(
    `
    SELECT id, fpl_id, name, finished, is_current, deadline_time
    FROM gameweeks
    WHERE fpl_id = $1
    LIMIT 1;
    `,
    [nextFplId]
  );

  if (next.rows.length === 0) {
    return {
      canDraw: false,
      pendingDraw: false,
      reason: `No gameweek ${nextFplId} found yet.`,
      previousGameweek: mapGw(previous),
      targetGameweek: null,
      alreadyDrawn: false,
      drawOpensAt: null,
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
      pendingDraw: false,
      reason: `GW${target.fpl_id} lottery already drawn.`,
      previousGameweek: mapGw(previous),
      targetGameweek: mapGw(target),
      alreadyDrawn: true,
      roundId: existing.rows[0].id,
      drawOpensAt: null,
    };
  }

  const window = getDrawWindowStatus(target.deadline_time, now);

  if (!window.deadlineTime) {
    return {
      canDraw: false,
      pendingDraw: true,
      reason: `GW${target.fpl_id} deadline not set yet — draw unlocks 24 hours before deadline.`,
      previousGameweek: mapGw(previous),
      targetGameweek: mapGw(target),
      alreadyDrawn: false,
      drawOpensAt: null,
    };
  }

  if (!window.isOpen) {
    return {
      canDraw: false,
      pendingDraw: true,
      reason: `Draw opens 24 hours before the GW${target.fpl_id} deadline (${formatDeadline(window.deadlineTime)}).`,
      previousGameweek: mapGw(previous),
      targetGameweek: mapGw(target),
      alreadyDrawn: false,
      drawOpensAt: window.drawOpensAt.toISOString(),
    };
  }

  return {
    canDraw: true,
    pendingDraw: true,
    reason: `GW${previous.fpl_id} finished — draw GW${target.fpl_id}.`,
    previousGameweek: mapGw(previous),
    targetGameweek: mapGw(target),
    alreadyDrawn: false,
    drawOpensAt: window.drawOpensAt.toISOString(),
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

  const result = {
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

  if (lottery.created) {
    void notifyH2HDraw({
      roundId: result.roundId,
      gameweek: result.gameweek,
      cancherosId,
    }).catch((err) => {
      console.warn("[h2h-draw] notifyH2HDraw failed:", err.message || String(err));
    });
  }

  return result;
}

function mapGw(row) {
  if (!row) return null;

  return {
    id: row.id,
    fplId: row.fpl_id,
    name: row.name,
    finished: row.finished,
    isCurrent: row.is_current ?? false,
    deadlineTime: row.deadline_time
      ? new Date(row.deadline_time).toISOString()
      : null,
  };
}

export function getDrawWindowStatus(deadlineTime, now = new Date()) {
  if (!deadlineTime) {
    return {
      deadlineTime: null,
      drawOpensAt: null,
      isOpen: false,
    };
  }

  const deadline = new Date(deadlineTime);
  const drawOpensAt = new Date(deadline.getTime() - DRAW_WINDOW_MS);

  return {
    deadlineTime: deadline,
    drawOpensAt,
    isOpen: now >= drawOpensAt,
  };
}

function formatDeadline(date) {
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
