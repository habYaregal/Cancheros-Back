import { Router } from "express";
import { asyncHandler } from "../middleware/errors.js";
import { pool } from "../config/database.js";
import { getCancherosLeague } from "../services/cancheros/cancheros.js";
import { getH2HStandings } from "../services/competitions/h2h.js";
import { getH2HWinner } from "../services/competitions/h2h.winner.js";
import { getCompetitionHistory } from "../services/competitions/history.js";
import {
  drawNextH2HLottery,
  getH2HDrawStatus,
} from "../services/competitions/h2h.draw.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const cancheros = await getCancherosLeague();
    const standings = await getH2HStandings(cancheros.id);
    const winner = await getH2HWinner(cancheros.id);

    res.json({
      standings: standings.map((row, index) => ({
        position: index + 1,
        memberId: row.member_id,
        fplId: row.fpl_id,
        firstName: row.first_name,
        lastName: row.last_name,
        teamName: row.team_name,
        played: row.played,
        wins: row.wins,
        draws: row.draws,
        losses: row.losses,
        points: row.points,
      })),
      winner: {
        tied: Boolean(winner.tied),
        resolvedBy: winner.resolvedBy,
        winner: winner.winner
          ? mapStandingPlayer(winner.winner)
          : null,
        winners: (winner.winners || []).map(
          mapStandingPlayer
        ),
        message: winner.message,
      },
    });
  })
);

/**
 * Whether the next H2H lottery can be drawn.
 * Only after a gameweek has finished.
 */
router.get(
  "/draw-status",
  asyncHandler(async (req, res) => {
    const cancheros = await getCancherosLeague();
    const status = await getH2HDrawStatus(cancheros.id);
    res.json(status);
  })
);

/**
 * Draw the next H2H lottery (GW N+1 after GW N finished).
 * Existing draws are never replaced.
 */
router.post(
  "/draw",
  asyncHandler(async (req, res) => {
    const cancheros = await getCancherosLeague();

    try {
      const result = await drawNextH2HLottery(cancheros.id);
      res.json(result);
    } catch (error) {
      if (error.status === 400) {
        res.status(400).json({
          error: error.message,
          drawStatus: error.drawStatus || null,
        });
        return;
      }
      throw error;
    }
  })
);

router.get(
  "/matches",
  asyncHandler(async (req, res) => {
    const cancheros = await getCancherosLeague();
    const gameweekFplId =
      req.query.gameweek != null
        ? Number(req.query.gameweek)
        : null;

    if (
      req.query.gameweek != null &&
      Number.isNaN(gameweekFplId)
    ) {
      const error = new Error("Invalid gameweek.");
      error.status = 400;
      throw error;
    }

    const params = [cancheros.id];
    let gameweekFilter = "";

    if (gameweekFplId != null) {
      params.push(gameweekFplId);
      gameweekFilter = `AND g.fpl_id = $2`;
    }

    const result = await pool.query(
      `
      SELECT
        hr.id AS round_id,
        g.fpl_id AS gameweek,
        g.name AS gameweek_name,
        hm.id AS match_id,
        hm.is_bye,
        hm.completed,
        hm.player_one_score,
        hm.player_two_score,
        hm.player_one_points,
        hm.player_two_points,
        hm.winner_member_id,

        p1.id AS player_one_member_id,
        fm1.first_name AS player_one_first_name,
        fm1.last_name AS player_one_last_name,
        fm1.team_name AS player_one_team_name,

        p2.id AS player_two_member_id,
        fm2.first_name AS player_two_first_name,
        fm2.last_name AS player_two_last_name,
        fm2.team_name AS player_two_team_name

      FROM h2h_rounds hr

      JOIN gameweeks g
        ON g.id = hr.gameweek_id

      JOIN h2h_matches hm
        ON hm.round_id = hr.id

      LEFT JOIN cancheros_members p1
        ON p1.id = hm.player_one_id

      LEFT JOIN fpl_managers fm1
        ON fm1.id = p1.manager_id

      LEFT JOIN cancheros_members p2
        ON p2.id = hm.player_two_id

      LEFT JOIN fpl_managers fm2
        ON fm2.id = p2.manager_id

      WHERE hr.cancheros_id = $1
        ${gameweekFilter}

      ORDER BY g.fpl_id, hm.id;
      `,
      params
    );

    res.json({
      count: result.rows.length,
      matches: result.rows.map((row) => ({
        roundId: row.round_id,
        matchId: row.match_id,
        gameweek: row.gameweek,
        gameweekName: row.gameweek_name,
        isBye: row.is_bye,
        completed: row.completed,
        playerOne: row.player_one_member_id
          ? {
              memberId: row.player_one_member_id,
              firstName: row.player_one_first_name,
              lastName: row.player_one_last_name,
              teamName: row.player_one_team_name,
              score: row.player_one_score,
              points: Number(row.player_one_points),
            }
          : null,
        playerTwo: row.is_bye
          ? null
          : row.player_two_member_id
            ? {
                memberId: row.player_two_member_id,
                firstName: row.player_two_first_name,
                lastName: row.player_two_last_name,
                teamName: row.player_two_team_name,
                score: row.player_two_score,
                points: Number(row.player_two_points),
              }
            : null,
        winnerMemberId: row.winner_member_id,
      })),
    });
  })
);

router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const cancheros = await getCancherosLeague();
    const history = await getCompetitionHistory(
      cancheros.id,
      "h2h"
    );

    res.json({ history });
  })
);

function mapStandingPlayer(row) {
  return {
    memberId: row.member_id,
    fplId: row.fpl_id,
    firstName: row.first_name,
    lastName: row.last_name,
    teamName: row.team_name,
    played: row.played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    points: row.points,
  };
}

export default router;
