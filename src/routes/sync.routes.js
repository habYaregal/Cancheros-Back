import { Router } from "express";
import { asyncHandler } from "../middleware/errors.js";
import {
  runQuickSync,
  runLiveSync,
} from "../services/sync/gameweek.pipeline.js";
import { getLiveSyncStatus } from "../services/sync/live.scheduler.js";

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

export default router;
