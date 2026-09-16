import { pool } from "../../config/database.js";
import { syncGameweeks } from "../fpl/fpl.gameweek.sync.js";
import { syncCancherosGameweek } from "../fpl/fpl.cancheros.sync.js";
import { syncCancherosScoresFromLeague } from "../fpl/fpl.score.live.js";
import { syncCancherosMembersFromFpl } from "../cancheros/cancheros.members.js";
import { generateH2HLottery } from "../competitions/h2h.lottery.js";
import { processH2HResults } from "../competitions/h2h.results.js";
import { notifyGameweekEnd } from "../../telegram/notifications.js";
import {
  recordWeeklyResult,
  recordMonthlyResult,
  recordSeasonResult,
  recordH2HResult,
} from "../competitions/history.js";

const notifiedGameweeks = new Set();

/**
 * Full Cancheros gameweek pipeline.
 */
export async function runGameweekPipeline(
  options = {},
  db = pool
) {
  const {
    gameweekFplId = null,
    syncMembers = true,
    syncBootstrap = true,
    createLottery = false,
    processResults = true,
    recordHistory = true,
    preferCurrent = true,
    scoreSource = "auto",
  } = options;

  const summary = {
    gameweeks: null,
    members: null,
    targetGameweek: null,
    scores: null,
    lottery: null,
    h2hResults: null,
    weekly: null,
    monthly: null,
    season: null,
    h2hAward: null,
  };

  if (syncBootstrap) {
    summary.gameweeks = await syncGameweeks(db);
  }

  if (syncMembers) {
    summary.members = await syncCancherosMembersFromFpl(db);
  }

  const cancheros = await getCancheros(db);
  const target = await resolveTargetGameweek(
    gameweekFplId,
    db,
    { preferCurrent }
  );

  summary.targetGameweek = target;

  if (!target) {
    return {
      ...summary,
      message: "No target gameweek available yet.",
    };
  }

  const useLeagueScores =
    scoreSource === "league" ||
    (scoreSource === "auto" && !target.finished);

  summary.scores = useLeagueScores
    ? await syncCancherosScoresFromLeague(target.fpl_id, db)
    : await syncCancherosGameweek(target.fpl_id, db);

  let roundId = null;

  if (createLottery) {
    summary.lottery = await generateH2HLottery(
      cancheros.id,
      target.id,
      db
    );
    roundId = summary.lottery.roundId;
  } else {
    const existing = await getH2HRound(
      cancheros.id,
      target.id,
      db
    );

    if (existing) {
      summary.lottery = {
        created: false,
        roundId: existing.id,
        matches: null,
      };
      roundId = existing.id;
    } else {
      summary.lottery = {
        created: false,
        roundId: null,
        reason: "No H2H lottery for this gameweek yet.",
      };
    }
  }

  if (processResults && roundId) {
    const syncedCount = (
      summary.scores.members || []
    ).filter((member) => member.synced).length;

    if (syncedCount > 0) {
      try {
        summary.h2hResults = await processH2HResults(
          roundId,
          db,
          { refresh: true }
        );
      } catch (error) {
        summary.h2hResults = {
          processed: false,
          error: error.message,
        };
      }
    } else {
      summary.h2hResults = {
        processed: false,
        reason: "No manager scores synced yet.",
      };
    }
  }

  if (recordHistory && target.finished) {
    summary.weekly = await recordWeeklyResult(
      cancheros.id,
      target.fpl_id,
      db
    );

    if (target.competition_month_id) {
      const monthComplete = await isCompetitionMonthComplete(
        target.competition_month_id,
        db
      );

      if (monthComplete) {
        summary.monthly = await recordMonthlyResult(
          cancheros.id,
          target.competition_month_id,
          db
        );
      }
    }

    if (target.fpl_id === 38) {
      summary.season = await recordSeasonResult(
        cancheros.id,
        target.season_id,
        db
      );

      summary.h2hAward = await recordH2HResult(
        cancheros.id,
        target.season_id,
        db
      );
    }

    const shouldNotifyGw =
      summary.weekly?.recorded &&
      roundId &&
      !notifiedGameweeks.has(target.fpl_id);

    if (shouldNotifyGw) {
      notifiedGameweeks.add(target.fpl_id);
      void notifyGameweekEnd({
        gameweekFplId: target.fpl_id,
        roundId,
        cancherosId: cancheros.id,
        db,
      }).catch((err) => {
        console.warn(
          `[gameweek-pipeline] notifyGameweekEnd (GW${target.fpl_id}) failed:`,
          err.message || String(err)
        );
      });
    }
  }

  return summary;
}

/**
 * Fast path for Refresh + live scheduler.
 * League standings feed (1 FPL call) + H2H refresh.
 */
export async function runQuickSync(db = pool) {
  return runGameweekPipeline(
    {
      preferCurrent: true,
      syncMembers: false,
      syncBootstrap: false,
      createLottery: false,
      processResults: true,
      recordHistory: true,
      scoreSource: "league",
    },
    db
  );
}

/**
 * Occasional full sync (roster + scores).
 */
export async function runLiveSync(db = pool) {
  return runGameweekPipeline(
    {
      preferCurrent: true,
      syncMembers: true,
      createLottery: false,
      processResults: true,
      recordHistory: true,
      scoreSource: "auto",
    },
    db
  );
}

async function getCancheros(db) {
  const result = await db.query(`
    SELECT id, name, start_gameweek
    FROM cancheros
    WHERE name = 'Cancheros'
    LIMIT 1;
  `);

  if (result.rows.length === 0) {
    throw new Error("Cancheros league not found.");
  }

  return result.rows[0];
}

async function getH2HRound(cancherosId, gameweekId, db) {
  const result = await db.query(
    `
    SELECT id
    FROM h2h_rounds
    WHERE cancheros_id = $1
      AND gameweek_id = $2
    LIMIT 1;
    `,
    [cancherosId, gameweekId]
  );

  return result.rows[0] || null;
}

async function resolveTargetGameweek(
  gameweekFplId,
  db,
  { preferCurrent = true } = {}
) {
  if (gameweekFplId != null) {
    const result = await db.query(
      `
      SELECT
        id,
        fpl_id,
        season_id,
        finished,
        is_previous,
        is_current,
        competition_month_id
      FROM gameweeks
      WHERE fpl_id = $1
      LIMIT 1;
      `,
      [gameweekFplId]
    );

    return result.rows[0] || null;
  }

  if (preferCurrent) {
    const current = await db.query(`
      SELECT
        id,
        fpl_id,
        season_id,
        finished,
        is_previous,
        is_current,
        competition_month_id
      FROM gameweeks
      WHERE is_current = true
      LIMIT 1;
    `);

    if (current.rows.length > 0) {
      return current.rows[0];
    }
  }

  const previous = await db.query(`
    SELECT
      id,
      fpl_id,
      season_id,
      finished,
      is_previous,
      is_current,
      competition_month_id
    FROM gameweeks
    WHERE is_previous = true
    LIMIT 1;
  `);

  if (previous.rows.length > 0) {
    return previous.rows[0];
  }

  const current = await db.query(`
    SELECT
      id,
      fpl_id,
      season_id,
      finished,
      is_previous,
      is_current,
      competition_month_id
    FROM gameweeks
    WHERE is_current = true
    LIMIT 1;
  `);

  return current.rows[0] || null;
}

async function isCompetitionMonthComplete(
  competitionMonthId,
  db
) {
  const result = await db.query(
    `
    SELECT
      COUNT(*)::integer AS total,
      COUNT(*) FILTER (
        WHERE finished = true
      )::integer AS finished_count
    FROM gameweeks
    WHERE competition_month_id = $1;
    `,
    [competitionMonthId]
  );

  const row = result.rows[0];

  return row.total > 0 && row.total === row.finished_count;
}
