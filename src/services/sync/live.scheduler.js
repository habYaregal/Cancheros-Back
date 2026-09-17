import {
  runQuickSync,
  runLiveSync,
} from "./gameweek.pipeline.js";
import { pool } from "../../config/database.js";
import { notifyDeadlineReminder } from "../../telegram/notifications.js";

const DEFAULT_INTERVAL_MS = 60 * 1000;
const FULL_SYNC_EVERY = 15;
const DEADLINE_REMINDER_WINDOW_MS = 4 * 60 * 60 * 1000;
const DEADLINE_REMINDER_GRACE_MS = 5 * 60 * 1000;

let timer = null;
let running = false;
let startedAt = null;
const deadlineRemindersSent = new Set();

export const liveSyncStatus = {
  enabled: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastSummary: null,
  runs: 0,
};

/**
 * Background sync loop — quick league-score refresh
 * every minute; full roster sync less often.
 */
export function startLiveSyncScheduler(options = {}) {
  const enabled =
    options.enabled ??
    String(process.env.LIVE_SYNC_ENABLED || "true")
      .toLowerCase() !== "false";

  const intervalMs = Number(
    options.intervalMs ??
      process.env.LIVE_SYNC_INTERVAL_MS ??
      DEFAULT_INTERVAL_MS
  );

  liveSyncStatus.enabled = enabled;
  liveSyncStatus.intervalMs = intervalMs;

  if (!enabled) {
    console.log("Live sync scheduler disabled.");
    return;
  }

  if (timer) {
    return;
  }

  startedAt = new Date().toISOString();
  console.log(
    `Live sync scheduler started (every ${intervalMs}ms).`
  );

  void tick();
  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

export function stopLiveSyncScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  liveSyncStatus.enabled = false;
}

async function tick() {
  if (running) {
    return;
  }

  running = true;
  liveSyncStatus.lastStartedAt = new Date().toISOString();
  liveSyncStatus.runs += 1;

  try {
    const useFullSync =
      liveSyncStatus.runs === 1 ||
      liveSyncStatus.runs % FULL_SYNC_EVERY === 0;

    const summary = useFullSync
      ? await runLiveSync()
      : await runQuickSync();

    liveSyncStatus.lastSuccessAt = new Date().toISOString();
    liveSyncStatus.lastError = null;
    liveSyncStatus.lastSummary = {
      mode: useFullSync ? "full" : "quick",
      gameweek: summary.targetGameweek?.fpl_id ?? null,
      finished: summary.targetGameweek?.finished ?? null,
      members: summary.members?.fplMemberCount ?? null,
      scoresSynced: (summary.scores?.members || []).filter(
        (row) => row.synced
      ).length,
      scoreSource: summary.scores?.source ?? null,
      h2hChanged: summary.h2hResults?.changed ?? null,
      h2hProcessed: summary.h2hResults?.processed ?? null,
      weeklyRecorded: summary.weekly?.recorded ?? null,
    };

    console.log(
      `[live-sync:${liveSyncStatus.lastSummary.mode}]` +
        ` GW${liveSyncStatus.lastSummary.gameweek}` +
        ` scores=${liveSyncStatus.lastSummary.scoresSynced}` +
        ` h2hChanged=${liveSyncStatus.lastSummary.h2hChanged}`
    );

    void checkDeadlineReminder().catch((err) => {
      console.warn(
        "[live-sync] deadline reminder check failed:",
        err.message || String(err)
      );
    });
  } catch (error) {
    liveSyncStatus.lastError = error.message || String(error);
    console.error("[live-sync] failed:", liveSyncStatus.lastError);
  } finally {
    liveSyncStatus.lastFinishedAt = new Date().toISOString();
    running = false;
  }
}

export function getLiveSyncStatus() {
  return {
    ...liveSyncStatus,
    startedAt,
    running,
  };
}

async function checkDeadlineReminder(db = pool) {
  try {
    const gw = await db.query(`
      SELECT id, fpl_id, name, finished, deadline_time
      FROM gameweeks
      WHERE is_current = true
      LIMIT 1;
    `);

    const row = gw.rows[0];
    if (!row) return null;

    const gwFplId = Number(row.fpl_id);
    if (row.finished) return null;
    if (!row.deadline_time) return null;
    if (deadlineRemindersSent.has(gwFplId)) return null;

    const deadline = new Date(row.deadline_time);
    const now = new Date();
    const msLeft = deadline.getTime() - now.getTime();

    if (msLeft <= 0) return null;
    if (msLeft > DEADLINE_REMINDER_WINDOW_MS + DEADLINE_REMINDER_GRACE_MS) {
      return null;
    }

    const hoursLeft = Math.ceil(msLeft / (60 * 60 * 1000));
    deadlineRemindersSent.add(gwFplId);

    const result = await notifyDeadlineReminder({
      gameweekFplId: gwFplId,
      gameweekName: row.name || null,
      deadlineTime: deadline,
      hoursLeft,
    });

    console.log(
      `[live-sync:deadline-reminder] GW${gwFplId} msLeft=${msLeft} hrsLeft=${hoursLeft} sent=${result.sent} failed=${result.failed}`
    );
    return result;
  } catch (err) {
    console.error(
      "[live-sync:deadline-reminder] error:",
      err.message || String(err)
    );
    return null;
  }
}
