import { Router } from "express";
import { asyncHandler } from "../middleware/errors.js";
import { pool } from "../config/database.js";
import { getMonthlyLeaderboard } from "../services/competitions/monthly.js";
import { getMonthlyWinner } from "../services/competitions/monthly.winner.js";
import { getCompetitionHistory } from "../services/competitions/history.js";
import { getCancherosLeague } from "../services/cancheros/cancheros.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const month = await resolveCompetitionMonth(
      req.query.month
    );

    const leaderboard = await getMonthlyLeaderboard(
      month.id
    );
    const winner = await getMonthlyWinner(month.id);

    res.json({
      month: {
        id: month.id,
        name: month.name,
        monthNumber: month.month_number,
        startDate: month.start_date,
        endDate: month.end_date,
      },
      leaderboard: leaderboard.map((row, index) => ({
        position: index + 1,
        memberId: row.member_id,
        managerId: row.manager_id,
        fplId: row.fpl_id,
        firstName: row.first_name,
        lastName: row.last_name,
        teamName: row.team_name,
        displayName: row.display_name,
        points: row.points,
        gameweeksPlayed: row.gameweeks_played,
      })),
      winner: {
        tied: Boolean(winner.tied),
        winner: winner.winner
          ? mapPlayer(winner.winner)
          : null,
        winners: (winner.winners || []).map(mapPlayer),
        message: winner.message,
      },
    });
  })
);

router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const cancheros = await getCancherosLeague();
    const history = await getCompetitionHistory(
      cancheros.id,
      "monthly"
    );

    res.json({ history });
  })
);

async function resolveCompetitionMonth(raw) {
  if (raw != null) {
    const value = Number(raw);

    if (Number.isNaN(value)) {
      const error = new Error("Invalid month id.");
      error.status = 400;
      throw error;
    }

    const result = await pool.query(
      `
      SELECT
        id,
        name,
        month_number,
        start_date,
        end_date
      FROM competition_months
      WHERE id = $1
      LIMIT 1;
      `,
      [value]
    );

    if (result.rows.length === 0) {
      const error = new Error("Month not found.");
      error.status = 404;
      throw error;
    }

    return result.rows[0];
  }

  const current = await pool.query(`
    SELECT
      cm.id,
      cm.name,
      cm.month_number,
      cm.start_date,
      cm.end_date
    FROM gameweeks g
    JOIN competition_months cm
      ON cm.id = g.competition_month_id
    WHERE g.is_current = true
    LIMIT 1;
  `);

  if (current.rows.length === 0) {
    const error = new Error(
      "No competition month for the current gameweek."
    );
    error.status = 404;
    throw error;
  }

  return current.rows[0];
}

function mapPlayer(row) {
  return {
    memberId: row.member_id,
    fplId: row.fpl_id,
    firstName: row.first_name,
    lastName: row.last_name,
    teamName: row.team_name,
    displayName: row.display_name,
    points: row.points,
    gameweeksPlayed: row.gameweeks_played,
  };
}

export default router;
