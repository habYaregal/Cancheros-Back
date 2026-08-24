import { Router } from "express";
import { asyncHandler } from "../middleware/errors.js";
import { pool } from "../config/database.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
      SELECT
        g.id,
        g.fpl_id,
        g.name,
        g.deadline_time,
        g.finished,
        g.is_previous,
        g.is_current,
        g.is_next,
        g.competition_month_id,
        cm.name AS month_name
      FROM gameweeks g
      LEFT JOIN competition_months cm
        ON cm.id = g.competition_month_id
      ORDER BY g.fpl_id;
    `);

    res.json({
      count: result.rows.length,
      gameweeks: result.rows.map((gw) => ({
        id: gw.id,
        fplId: gw.fpl_id,
        name: gw.name,
        deadlineTime: gw.deadline_time,
        finished: gw.finished,
        isPrevious: gw.is_previous,
        isCurrent: gw.is_current,
        isNext: gw.is_next,
        competitionMonthId: gw.competition_month_id,
        monthName: gw.month_name,
      })),
    });
  })
);

router.get(
  "/current",
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
      SELECT
        id,
        fpl_id,
        name,
        deadline_time,
        finished,
        is_previous,
        is_current,
        is_next,
        competition_month_id
      FROM gameweeks
      WHERE is_current = true
      LIMIT 1;
    `);

    if (result.rows.length === 0) {
      const error = new Error("No current gameweek.");
      error.status = 404;
      throw error;
    }

    const gw = result.rows[0];

    res.json({
      id: gw.id,
      fplId: gw.fpl_id,
      name: gw.name,
      deadlineTime: gw.deadline_time,
      finished: gw.finished,
      isPrevious: gw.is_previous,
      isCurrent: gw.is_current,
      isNext: gw.is_next,
      competitionMonthId: gw.competition_month_id,
    });
  })
);

export default router;
