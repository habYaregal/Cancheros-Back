import { pool } from "../../config/database.js";
import { getWeeklyWinner } from "./weekly.winner.js";
import { getMonthlyWinner } from "./monthly.winner.js";
import { getSeasonWinner } from "./season.winner.js";
import { getH2HWinner } from "./h2h.winner.js";

/**
 * Persist a competition result + winner rows.
 * Idempotent: re-recording replaces winners for
 * the same period.
 */
async function saveCompetitionResult(
  {
    cancherosId,
    competitionType,
    seasonId = null,
    gameweekId = null,
    competitionMonthId = null,
    tied,
    resolvedBy = null,
    winners,
  },
  db = pool
) {
  const client =
    db === pool ? await pool.connect() : db;

  const shouldRelease = db === pool;

  try {
    if (shouldRelease) {
      await client.query("BEGIN");
    }

    const existing = await findExistingResult(
      {
        cancherosId,
        competitionType,
        seasonId,
        gameweekId,
        competitionMonthId,
      },
      client
    );

    let resultId;

    if (existing) {
      resultId = existing.id;

      await client.query(
        `
        UPDATE competition_results
        SET
          tied = $1,
          resolved_by = $2,
          season_id = COALESCE($3, season_id),
          finalized_at = NOW()
        WHERE id = $4;
        `,
        [tied, resolvedBy, seasonId, resultId]
      );

      await client.query(
        `
        DELETE FROM competition_result_winners
        WHERE result_id = $1;
        `,
        [resultId]
      );
    } else {
      const inserted = await client.query(
        `
        INSERT INTO competition_results (
          cancheros_id,
          competition_type,
          season_id,
          gameweek_id,
          competition_month_id,
          tied,
          resolved_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id;
        `,
        [
          cancherosId,
          competitionType,
          seasonId,
          gameweekId,
          competitionMonthId,
          tied,
          resolvedBy,
        ]
      );

      resultId = inserted.rows[0].id;
    }

    for (const winner of winners) {
      await client.query(
        `
        INSERT INTO competition_result_winners (
          result_id,
          member_id,
          points,
          wins
        )
        VALUES ($1, $2, $3, $4);
        `,
        [
          resultId,
          winner.member_id,
          winner.points ?? null,
          winner.wins ?? null,
        ]
      );
    }

    if (shouldRelease) {
      await client.query("COMMIT");
    }

    return {
      resultId,
      created: !existing,
      updated: Boolean(existing),
      tied,
      winners,
    };
  } catch (error) {
    if (shouldRelease) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

async function findExistingResult(
  {
    cancherosId,
    competitionType,
    seasonId,
    gameweekId,
    competitionMonthId,
  },
  db
) {
  if (competitionType === "weekly") {
    const result = await db.query(
      `
      SELECT id
      FROM competition_results
      WHERE cancheros_id = $1
        AND competition_type = 'weekly'
        AND gameweek_id = $2
      LIMIT 1;
      `,
      [cancherosId, gameweekId]
    );

    return result.rows[0] || null;
  }

  if (competitionType === "monthly") {
    const result = await db.query(
      `
      SELECT id
      FROM competition_results
      WHERE cancheros_id = $1
        AND competition_type = 'monthly'
        AND competition_month_id = $2
      LIMIT 1;
      `,
      [cancherosId, competitionMonthId]
    );

    return result.rows[0] || null;
  }

  const result = await db.query(
    `
    SELECT id
    FROM competition_results
    WHERE cancheros_id = $1
      AND competition_type = $2
      AND season_id = $3
    LIMIT 1;
    `,
    [cancherosId, competitionType, seasonId]
  );

  return result.rows[0] || null;
}

export async function recordWeeklyResult(
  cancherosId,
  gameweekFplId,
  db = pool
) {
  const gameweek = await db.query(
    `
    SELECT id, season_id, fpl_id, finished
    FROM gameweeks
    WHERE fpl_id = $1
    LIMIT 1;
    `,
    [gameweekFplId]
  );

  if (gameweek.rows.length === 0) {
    throw new Error(
      `Gameweek ${gameweekFplId} not found.`
    );
  }

  const gw = gameweek.rows[0];
  const outcome = await getWeeklyWinner(
    gameweekFplId,
    db
  );

  if (!outcome.winners || outcome.winners.length === 0) {
    return {
      recorded: false,
      reason: outcome.message || "No winners.",
      gameweek: gameweekFplId,
    };
  }

  const saved = await saveCompetitionResult(
    {
      cancherosId,
      competitionType: "weekly",
      seasonId: gw.season_id,
      gameweekId: gw.id,
      tied: Boolean(outcome.tied),
      resolvedBy: outcome.tied ? "joint" : "points",
      winners: outcome.winners,
    },
    db
  );

  return {
    recorded: true,
    competitionType: "weekly",
    gameweek: gameweekFplId,
    ...saved,
  };
}

export async function recordMonthlyResult(
  cancherosId,
  competitionMonthId,
  db = pool
) {
  const outcome = await getMonthlyWinner(
    competitionMonthId,
    db
  );

  if (!outcome.winners || outcome.winners.length === 0) {
    return {
      recorded: false,
      reason: outcome.message || "No winners.",
      month: competitionMonthId,
    };
  }

  const month = await db.query(
    `
    SELECT id, season_id
    FROM competition_months
    WHERE id = $1
    LIMIT 1;
    `,
    [competitionMonthId]
  );

  if (month.rows.length === 0) {
    throw new Error(
      `Competition month ${competitionMonthId} not found.`
    );
  }

  const saved = await saveCompetitionResult(
    {
      cancherosId,
      competitionType: "monthly",
      seasonId: month.rows[0].season_id,
      competitionMonthId,
      tied: Boolean(outcome.tied),
      resolvedBy: outcome.tied ? "joint" : "points",
      winners: outcome.winners,
    },
    db
  );

  return {
    recorded: true,
    competitionType: "monthly",
    month: competitionMonthId,
    ...saved,
  };
}

export async function recordSeasonResult(
  cancherosId,
  seasonId,
  db = pool
) {
  const outcome = await getSeasonWinner(seasonId, db);

  if (!outcome.winners || outcome.winners.length === 0) {
    return {
      recorded: false,
      reason: outcome.message || "No winners.",
      season: seasonId,
    };
  }

  const saved = await saveCompetitionResult(
    {
      cancherosId,
      competitionType: "season",
      seasonId,
      tied: Boolean(outcome.tied),
      resolvedBy: outcome.tied ? "joint" : "points",
      winners: outcome.winners,
    },
    db
  );

  return {
    recorded: true,
    competitionType: "season",
    season: seasonId,
    ...saved,
  };
}

export async function recordH2HResult(
  cancherosId,
  seasonId,
  db = pool
) {
  const outcome = await getH2HWinner(cancherosId, db);

  if (!outcome.winners || outcome.winners.length === 0) {
    return {
      recorded: false,
      reason: outcome.message || "No winners.",
      season: seasonId,
    };
  }

  const saved = await saveCompetitionResult(
    {
      cancherosId,
      competitionType: "h2h",
      seasonId,
      tied: Boolean(outcome.tied),
      resolvedBy: outcome.resolvedBy,
      winners: outcome.winners,
    },
    db
  );

  return {
    recorded: true,
    competitionType: "h2h",
    season: seasonId,
    ...saved,
  };
}

/**
 * Historical winners for a competition type,
 * oldest period first.
 */
export async function getCompetitionHistory(
  cancherosId,
  competitionType,
  db = pool
) {
  const result = await db.query(
    `
    SELECT
      cr.id AS result_id,
      cr.competition_type,
      cr.tied,
      cr.resolved_by,
      cr.finalized_at,

      cr.season_id,
      s.name AS season_name,

      cr.gameweek_id,
      g.fpl_id AS gameweek_fpl_id,
      g.name AS gameweek_name,

      cr.competition_month_id,
      cm.name AS month_name,
      cm.month_number,

      crw.member_id,
      crw.points,
      crw.wins,

      fm.fpl_id,
      fm.first_name,
      fm.last_name,
      fm.team_name,
      member.display_name

    FROM competition_results cr

    LEFT JOIN seasons s
      ON s.id = cr.season_id

    LEFT JOIN gameweeks g
      ON g.id = cr.gameweek_id

    LEFT JOIN competition_months cm
      ON cm.id = cr.competition_month_id

    JOIN competition_result_winners crw
      ON crw.result_id = cr.id

    JOIN cancheros_members member
      ON member.id = crw.member_id

    JOIN fpl_managers fm
      ON fm.id = member.manager_id

    WHERE cr.cancheros_id = $1
      AND cr.competition_type = $2

    ORDER BY
      g.fpl_id ASC NULLS LAST,
      cm.month_number ASC NULLS LAST,
      cr.finalized_at ASC,
      crw.id ASC;
    `,
    [cancherosId, competitionType]
  );

  return groupHistoryRows(result.rows);
}

function groupHistoryRows(rows) {
  const byResult = new Map();

  for (const row of rows) {
    if (!byResult.has(row.result_id)) {
      byResult.set(row.result_id, {
        resultId: row.result_id,
        competitionType: row.competition_type,
        tied: row.tied,
        resolvedBy: row.resolved_by,
        finalizedAt: row.finalized_at,
        seasonId: row.season_id,
        seasonName: row.season_name,
        gameweekId: row.gameweek_id,
        gameweek: row.gameweek_fpl_id,
        gameweekName: row.gameweek_name,
        competitionMonthId: row.competition_month_id,
        monthName: row.month_name,
        monthNumber: row.month_number,
        winners: [],
      });
    }

    byResult.get(row.result_id).winners.push({
      member_id: row.member_id,
      points:
        row.points === null ? null : Number(row.points),
      wins: row.wins,
      fpl_id: row.fpl_id,
      first_name: row.first_name,
      last_name: row.last_name,
      team_name: row.team_name,
      display_name: row.display_name,
    });
  }

  return [...byResult.values()];
}
