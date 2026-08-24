import { Router } from "express";
import { asyncHandler } from "../middleware/errors.js";
import { getSeasonLeaderboard } from "../services/competitions/season.js";
import { getSeasonWinner } from "../services/competitions/season.winner.js";
import { pool } from "../config/database.js";

const router = Router();

/**
 * Season FPL points standings (default "standings").
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const season = await getCurrentSeason();
    const leaderboard = await getSeasonLeaderboard(season.id);
    const winner = await getSeasonWinner(season.id);

    res.json({
      season: {
        id: season.id,
        name: season.name,
      },
      standings: leaderboard.map((row, index) => ({
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
      winner: formatWinnerPayload(winner),
    });
  })
);

async function getCurrentSeason() {
  const result = await pool.query(`
    SELECT id, name
    FROM seasons
    WHERE is_current = true
    ORDER BY id DESC
    LIMIT 1;
  `);

  if (result.rows.length === 0) {
    const error = new Error("No current season found.");
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}

function formatWinnerPayload(outcome) {
  return {
    tied: Boolean(outcome.tied),
    winner: outcome.winner
      ? {
          memberId: outcome.winner.member_id,
          fplId: outcome.winner.fpl_id,
          firstName: outcome.winner.first_name,
          lastName: outcome.winner.last_name,
          teamName: outcome.winner.team_name,
          points: outcome.winner.points,
        }
      : null,
    winners: (outcome.winners || []).map((row) => ({
      memberId: row.member_id,
      fplId: row.fpl_id,
      firstName: row.first_name,
      lastName: row.last_name,
      teamName: row.team_name,
      points: row.points,
    })),
    message: outcome.message,
  };
}

export default router;
