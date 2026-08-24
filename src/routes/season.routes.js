import { Router } from "express";
import { asyncHandler } from "../middleware/errors.js";
import { pool } from "../config/database.js";
import { getSeasonLeaderboard } from "../services/competitions/season.js";
import { getSeasonWinner } from "../services/competitions/season.winner.js";
import { getCompetitionHistory } from "../services/competitions/history.js";
import { getCancherosLeague } from "../services/cancheros/cancheros.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const season = await resolveSeason(req.query.season);

    const leaderboard = await getSeasonLeaderboard(
      season.id
    );
    const winner = await getSeasonWinner(season.id);

    res.json({
      season: {
        id: season.id,
        name: season.name,
        isCurrent: season.is_current,
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
      "season"
    );

    res.json({ history });
  })
);

async function resolveSeason(raw) {
  if (raw != null) {
    const value = Number(raw);

    if (Number.isNaN(value)) {
      const error = new Error("Invalid season id.");
      error.status = 400;
      throw error;
    }

    const result = await pool.query(
      `
      SELECT id, name, is_current
      FROM seasons
      WHERE id = $1
      LIMIT 1;
      `,
      [value]
    );

    if (result.rows.length === 0) {
      const error = new Error("Season not found.");
      error.status = 404;
      throw error;
    }

    return result.rows[0];
  }

  const result = await pool.query(`
    SELECT id, name, is_current
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
