import { Router } from "express";
import { pool } from "../config/database.js";
import { asyncHandler } from "../middleware/errors.js";
import {
  runQuickSync,
  runLiveSync,
} from "../services/sync/gameweek.pipeline.js";
import { getLiveSyncStatus } from "../services/sync/live.scheduler.js";
import { notifyGameweekEnd } from "../telegram/notifications.js";
import { NOTIFICATION_EVENT } from "../services/telegram/notificationLog.js";

const router = Router();

router.get(
  "/status",
  asyncHandler(async (req, res) => {
    res.json(getLiveSyncStatus());
  })
);

/**
 * Fast refresh — league live scores + H2H.
 * Used by the website Refresh button.
 */
router.post(
  "/live",
  asyncHandler(async (req, res) => {
    const full = String(req.query.full || "") === "true";
    const summary = full
      ? await runLiveSync()
      : await runQuickSync();

    res.json({
      ok: true,
      mode: full ? "full" : "quick",
      gameweek: summary.targetGameweek,
      scores: summary.scores,
      lottery: summary.lottery,
      h2hResults: summary.h2hResults,
      weekly: summary.weekly,
      liveSync: getLiveSyncStatus(),
    });
  })
);

/**
 * Admin helper: clear the gw_end_summary notification_log row
 * for a specific gameweek and re-send the updated (all-over-stats)
 * summary exactly once. Use this ONLY for the current spam-affected GW.
 *
 * Query params:
 *   gameweek  (optional) FPL gameweek id, e.g. 6. Defaults to most
 *             recent finished gameweek.
 */
router.post(
  "/notifications/reset-gw-summary",
  asyncHandler(async (req, res) => {
    const rawGw = req.query.gameweek;
    const targetGwFplId = rawGw != null && rawGw !== "" ? Number(rawGw) : null;

    const cancheros = await pool.query(`
      SELECT id FROM cancheros WHERE name = 'Cancheros' LIMIT 1;
    `);
    if (cancheros.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Cancheros league not found." });
    }
    const cancherosId = cancheros.rows[0].id;

    let targetGw;
    if (targetGwFplId) {
      const r = await pool.query(
        `
        SELECT id, fpl_id, finished, is_current, is_previous
        FROM gameweeks
        WHERE fpl_id = $1
        LIMIT 1;
        `,
        [targetGwFplId]
      );
      targetGw = r.rows[0] || null;
    } else {
      const r = await pool.query(`
        SELECT id, fpl_id, finished, is_current, is_previous
        FROM gameweeks
        ORDER BY
          CASE WHEN is_previous = true THEN 0 ELSE 1 END,
          fpl_id DESC
        LIMIT 1;
      `);
      targetGw = r.rows[0] || null;
    }

    if (!targetGw) {
      return res.status(404).json({ ok: false, error: "Target gameweek not found." });
    }

    const deleted = await pool.query(
      `
      DELETE FROM notification_log
      WHERE cancheros_id = $1
        AND gameweek_id = $2
        AND event_type = $3
      RETURNING *;
      `,
      [cancherosId, targetGw.id, NOTIFICATION_EVENT.GW_END_SUMMARY]
    );

    let roundId = null;
    const round = await pool.query(
      `
      SELECT id
      FROM h2h_rounds
      WHERE cancheros_id = $1 AND gameweek_id = $2
      LIMIT 1;
      `,
      [cancherosId, targetGw.id]
    );
    if (round.rows.length > 0) roundId = round.rows[0].id;

    const result = await notifyGameweekEnd({
      gameweekFplId: targetGw.fpl_id,
      gameweekId: targetGw.id,
      roundId,
      cancherosId,
      db: pool,
    });

    res.json({
      ok: true,
      gameweek: {
        id: targetGw.id,
        fplId: targetGw.fpl_id,
        finished: targetGw.finished,
        isCurrent: targetGw.is_current,
        isPrevious: targetGw.is_previous,
      },
      deletedLogRows: deleted.rowCount,
      deleted: deleted.rows.map((r) => ({
        sentAt: r.sent_at,
        sent: r.sent_count,
        failed: r.failed_count,
      })),
      resent: result,
    });
  })
);

export default router;
