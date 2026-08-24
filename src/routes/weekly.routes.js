import { Router } from "express";
import { asyncHandler } from "../middleware/errors.js";
import { pool } from "../config/database.js";
import { getWeeklyLeaderboard } from "../services/competitions/weekly.js";
import { getWeeklyWinner } from "../services/competitions/weekly.winner.js";
import { getCompetitionHistory } from "../services/competitions/history.js";
import { getCancherosLeague } from "../services/cancheros/cancheros.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const gameweekFplId = await resolveGameweekFplId(
      req.query.gameweek
    );

    const leaderboard = await getWeeklyLeaderboard(
      gameweekFplId
    );
    const winner = await getWeeklyWinner(gameweekFplId);

    res.json({
      gameweek: gameweekFplId,
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
      "weekly"
    );

    res.json({ history });
  })
);

async function resolveGameweekFplId(raw) {
  if (raw != null) {
    const value = Number(raw);

    if (Number.isNaN(value)) {
      const error = new Error("Invalid gameweek.");
      error.status = 400;
      throw error;
    }

    return value;
  }

  const current = await pool.query(`
    SELECT fpl_id
    FROM gameweeks
    WHERE is_current = true
    LIMIT 1;
  `);

  if (current.rows.length === 0) {
    const error = new Error("No current gameweek.");
    error.status = 404;
    throw error;
  }

  return current.rows[0].fpl_id;
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
  };
}

export default router;
