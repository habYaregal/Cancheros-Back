import { pool } from "../config/database.js";
import { formatEthiopianDateTime } from "../config/time.js";
import { getBot } from "./bot.js";
import { getRegisteredMembers } from "../services/telegram/accounts.js";
import { getH2HStandings } from "../services/competitions/h2h.js";
import { getWeeklyLeaderboard } from "../services/competitions/weekly.js";
import { getSeasonLeaderboard } from "../services/competitions/season.js";
import { getMonthlyLeaderboard } from "../services/competitions/monthly.js";
import {
  hasNotified,
  markNotified,
  NOTIFICATION_EVENT,
} from "../services/telegram/notificationLog.js";

async function getRoundMatchesWithMembers(roundId, db = pool) {
  const result = await db.query(
    `
    SELECT
      hm.id AS match_id,
      hm.is_bye,
      hm.completed,
      hm.player_one_score,
      hm.player_two_score,
      hm.player_one_points,
      hm.player_two_points,

      p1.id AS p1_member_id,
      fm1.first_name AS p1_first,
      fm1.last_name AS p1_last,
      fm1.team_name AS p1_team,

      p2.id AS p2_member_id,
      fm2.first_name AS p2_first,
      fm2.last_name AS p2_last,
      fm2.team_name AS p2_team

    FROM h2h_matches hm

    LEFT JOIN cancheros_members p1 ON p1.id = hm.player_one_id
    LEFT JOIN fpl_managers fm1 ON fm1.id = p1.manager_id

    LEFT JOIN cancheros_members p2 ON p2.id = hm.player_two_id
    LEFT JOIN fpl_managers fm2 ON fm2.id = p2.manager_id

    WHERE hm.round_id = $1
    ORDER BY hm.id;
    `,
    [roundId]
  );

  return result.rows;
}

async function sendDm(userId, text) {
  const bot = getBot();
  if (!bot) return { ok: false, skipped: true };
  try {
    await bot.api.sendMessage(userId, text, {
      disable_web_page_preview: true,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function resolveGameweekMeta(gameweekFplId, gameweekId, db = pool) {
  if (gameweekId) {
    const result = await db.query(
      `
      SELECT id, fpl_id, season_id, competition_month_id
      FROM gameweeks
      WHERE id = $1
      LIMIT 1;
      `,
      [gameweekId]
    );
    if (result.rows.length > 0) return result.rows[0];
  }
  const result = await db.query(
    `
    SELECT id, fpl_id, season_id, competition_month_id
    FROM gameweeks
    WHERE fpl_id = $1
    LIMIT 1;
    `,
    [gameweekFplId]
  );
  return result.rows[0] || null;
}

async function resolveCancherosId(db = pool) {
  const result = await db.query(`
    SELECT id FROM cancheros WHERE name = 'Cancheros' LIMIT 1;
  `);
  return result.rows[0]?.id || null;
}

function buildPositionIndex(rows) {
  const idx = new Map();
  rows.forEach((row, i) => {
    const memberId = Number(row.member_id);
    idx.set(memberId, {
      position: i + 1,
      points: Number(row.points) || 0,
      first_name: row.first_name,
      last_name: row.last_name,
      team_name: row.team_name,
    });
  });
  return idx;
}

export async function notifyH2HDraw({ roundId, gameweek, cancherosId, db = pool }) {
  const bot = getBot();
  if (!bot) {
    return { sent: 0, failed: 0, skipped: true, reason: "Bot not started" };
  }

  try {
    const gwFplId = gameweek?.fplId ?? gameweek?.fpl_id;
    const gwId = gameweek?.id ?? null;
    if (!roundId || !gwFplId) {
      return { sent: 0, failed: 0, reason: "Missing roundId or gameweek" };
    }

    const gwMeta = await resolveGameweekMeta(gwFplId, gwId, db);
    if (gwMeta && cancherosId) {
      const alreadySent = await hasNotified(
        cancherosId,
        gwMeta.id,
        NOTIFICATION_EVENT.H2H_DRAW,
        db
      );
      if (alreadySent) {
        console.log(
          `[tg:notify-h2h-draw] GW${gwFplId} skipped (already notified per notification_log)`
        );
        return {
          sent: 0,
          failed: 0,
          skipped: true,
          reason: "Already notified (notification_log)",
          roundId,
          gameweek: gwFplId,
        };
      }
    }

    const [members, matches] = await Promise.all([
      getRegisteredMembers(),
      getRoundMatchesWithMembers(roundId, db),
    ]);

    if (members.length === 0) {
      return { sent: 0, failed: 0, reason: "No registered members" };
    }

    function matchForMember(memberId) {
      return matches.find(
        (m) =>
          Number(m.p1_member_id) === Number(memberId) ||
          Number(m.p2_member_id) === Number(memberId)
      );
    }

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const member of members) {
      try {
        const match = matchForMember(member.memberId);
        if (!match) continue;

        const isP1 = Number(match.p1_member_id) === Number(member.memberId);

        let body;
        if (match.is_bye) {
          body = [
            `🎲 H2H Draw — GW${gwFplId}`,
            "",
            "BYE this week. Enjoy the automatic 1.5 points.",
          ].join("\n");
        } else {
          const oppFirstName = isP1 ? match.p2_first : match.p1_first;
          const oppLastName = isP1 ? match.p2_last : match.p1_last;
          const oppTeam = isP1 ? match.p2_team : match.p1_team;

          body = [
            `🎲 H2H Draw — GW${gwFplId}`,
            "",
            `Your opponent: ${oppFirstName} ${oppLastName}`,
            oppTeam ? `Team: ${oppTeam}` : null,
          ]
            .filter(Boolean)
            .join("\n");
        }

        const res = await sendDm(member.telegramUserId, body);
        if (res.ok) sent++;
        else if (!res.skipped) {
          failed++;
          if (res.error) errors.push({ member: member.memberId, err: res.error });
        }
      } catch (err) {
        failed++;
        errors.push({ member: member.memberId, err: err.message || String(err) });
      }
    }

    if (gwMeta && cancherosId) {
      await markNotified(
        {
          cancherosId,
          gameweekId: gwMeta.id,
          eventType: NOTIFICATION_EVENT.H2H_DRAW,
          sent,
          failed,
          errors: errors.length > 0 ? errors : null,
        },
        db
      );
    }

    console.log(
      `[tg:notify-h2h-draw] GW${gwFplId} sent=${sent} failed=${failed}`
    );
    return { sent, failed, roundId, gameweek: gwFplId, idempotent: Boolean(gwMeta && cancherosId) };
  } catch (err) {
    console.error("[tg:notify-h2h-draw] failed:", err.message || String(err));
    return { sent: 0, failed: 0, error: err.message || String(err) };
  }
}

export async function notifyGameweekEnd({
  gameweekFplId,
  gameweekId = null,
  roundId,
  cancherosId,
  db = pool,
}) {
  const bot = getBot();
  if (!bot) {
    return { sent: 0, failed: 0, skipped: true, reason: "Bot not started" };
  }

  try {
    if (!gameweekFplId && !gameweekId) {
      return { sent: 0, failed: 0, reason: "Missing gameweekFplId or gameweekId" };
    }

    const gwMeta = await resolveGameweekMeta(gameweekFplId, gameweekId, db);
    if (!gwMeta) {
      return { sent: 0, failed: 0, reason: "Gameweek not found" };
    }
    const resolvedGwId = gwMeta.id;
    const resolvedFplId = gwMeta.fpl_id;
    const seasonId = gwMeta.season_id;
    const competitionMonthId = gwMeta.competition_month_id;

    if (cancherosId) {
      const alreadySent = await hasNotified(
        cancherosId,
        resolvedGwId,
        NOTIFICATION_EVENT.GW_END_SUMMARY,
        db
      );
      if (alreadySent) {
        console.log(
          `[tg:notify-gw-end] GW${resolvedFplId} skipped (already notified per notification_log)`
        );
        return {
          sent: 0,
          failed: 0,
          skipped: true,
          reason: "Already notified (notification_log)",
          gameweekFplId: resolvedFplId,
          roundId: roundId ?? null,
        };
      }
    }

    const [
      members,
      standingsRaw,
      matches,
      weeklyRows,
      seasonRows,
      monthlyRows,
    ] = await Promise.all([
      getRegisteredMembers(),
      cancherosId ? getH2HStandings(cancherosId, db) : [],
      roundId ? getRoundMatchesWithMembers(roundId, db) : [],
      getWeeklyLeaderboard(resolvedFplId, db),
      seasonId ? getSeasonLeaderboard(seasonId, db) : [],
      competitionMonthId ? getMonthlyLeaderboard(competitionMonthId, db) : [],
    ]);

    if (members.length === 0) {
      return { sent: 0, failed: 0, reason: "No registered members" };
    }

    const h2hStandings = standingsRaw.map((row, idx) => ({
      ...row,
      position: idx + 1,
    }));

    const weeklyIdx = buildPositionIndex(weeklyRows);
    const seasonIdx = buildPositionIndex(seasonRows);
    const monthlyIdx = buildPositionIndex(monthlyRows);

    const weeklyTop3 = weeklyRows.slice(0, 3);
    const seasonTop3 = seasonRows.slice(0, 3);
    const h2hTop3 = h2hStandings.slice(0, 3).map((row) => {
      const pd = Number(row.points_difference) || 0;
      const pdSign = pd >= 0 ? "+" : "";
      return `#${row.position} ${row.first_name} ${row.last_name} — ${row.points} pts (${pdSign}${pd} PD)`;
    });

    function matchForMember(memberId) {
      return matches.find(
        (m) =>
          Number(m.p1_member_id) === Number(memberId) ||
          Number(m.p2_member_id) === Number(memberId)
      );
    }

    function h2hForMember(memberId) {
      return h2hStandings.find(
        (row) => Number(row.member_id) === Number(memberId)
      );
    }

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const member of members) {
      try {
        const mid = Number(member.memberId);
        const lines = [];
        lines.push(`🏁 GW${resolvedFplId} Complete`);
        lines.push("");

        const wk = weeklyIdx.get(mid);
        if (wk) {
          lines.push(`⭐ This week: #${wk.position} — ${wk.points} pts`);
        } else {
          lines.push("⭐ This week: no score yet");
        }

        const sn = seasonIdx.get(mid);
        if (sn) {
          lines.push(`Season: #${sn.position} — ${sn.points} pts`);
        }

        const mo = monthlyIdx.get(mid);
        if (mo && competitionMonthId) {
          lines.push(`Month: #${mo.position} — ${mo.points} pts`);
        }
        lines.push("");

        const match = matchForMember(mid);
        if (match) {
          if (match.is_bye) {
            lines.push("H2H: BYE (+1.5 pts)");
          } else {
            const isP1 = Number(match.p1_member_id) === mid;
            const myPts = isP1
              ? Number(match.player_one_points)
              : Number(match.player_two_points);
            const myScore = isP1
              ? match.player_one_score
              : match.player_two_score;
            const oppFirstName = isP1 ? match.p2_first : match.p1_first;
            const oppLastName = isP1 ? match.p2_last : match.p1_last;
            const oppScore = isP1
              ? match.player_two_score
              : match.player_one_score;

            let resultLabel = "Draw";
            if (myPts === 3) resultLabel = "Win";
            else if (myPts === 0) resultLabel = "Loss";

            lines.push(`H2H: ${resultLabel} vs ${oppFirstName} ${oppLastName}`);
            lines.push(
              `  Score: ${Number(myScore) ?? "-"} — ${Number(oppScore) ?? "-"}`
            );
            lines.push(`  Match points: +${myPts}`);
          }
          lines.push("");
        }

        const h2h = h2hForMember(mid);
        if (h2h) {
          const pd = Number(h2h.points_difference) || 0;
          const pdSign = pd >= 0 ? "+" : "";
          lines.push(
            `H2H Table: #${h2h.position} · ${h2h.points} pts · PD ${pdSign}${pd}`
          );
          lines.push(
            `  Record: ${h2h.wins}W ${h2h.draws}D ${h2h.losses}L`
          );
        } else {
          lines.push("H2H Table: no ranking data yet");
        }

        if (weeklyTop3.length > 0) {
          lines.push("");
          lines.push("Weekly Top 3:");
          weeklyTop3.forEach((row, i) => {
            lines.push(
              `  #${i + 1} ${row.first_name} ${row.last_name} — ${
                Number(row.points) || 0
              } pts`
            );
          });
        }

        if (seasonTop3.length > 0) {
          lines.push("");
          lines.push("Season Top 3:");
          seasonTop3.forEach((row, i) => {
            lines.push(
              `  #${i + 1} ${row.first_name} ${row.last_name} — ${
                Number(row.points) || 0
              } pts`
            );
          });
        }

        if (h2hTop3.length > 0) {
          lines.push("");
          lines.push("H2H Top 3:");
          for (const t of h2hTop3) lines.push(`  ${t}`);
        }

        const body = lines.join("\n");
        const res = await sendDm(member.telegramUserId, body);
        if (res.ok) sent++;
        else if (!res.skipped) {
          failed++;
          if (res.error) errors.push({ member: member.memberId, err: res.error });
        }
      } catch (err) {
        failed++;
        errors.push({ member: member.memberId, err: err.message || String(err) });
      }
    }

    if (cancherosId) {
      await markNotified(
        {
          cancherosId,
          gameweekId: resolvedGwId,
          eventType: NOTIFICATION_EVENT.GW_END_SUMMARY,
          sent,
          failed,
          errors: errors.length > 0 ? errors : null,
        },
        db
      );
    }

    console.log(
      `[tg:notify-gw-end] GW${resolvedFplId} sent=${sent} failed=${failed}`
    );
    return {
      sent,
      failed,
      gameweekFplId: resolvedFplId,
      roundId: roundId ?? null,
      idempotent: Boolean(cancherosId),
    };
  } catch (err) {
    console.error("[tg:notify-gw-end] failed:", err.message || String(err));
    return { sent: 0, failed: 0, error: err.message || String(err) };
  }
}

export async function notifyDeadlineReminder({
  gameweekFplId,
  gameweekName,
  deadlineTime,
  hoursLeft,
  cancherosId = null,
  db = pool,
}) {
  const bot = getBot();
  if (!bot) {
    return { sent: 0, failed: 0, skipped: true, reason: "Bot not started" };
  }

  try {
    if (!gameweekFplId) {
      return { sent: 0, failed: 0, reason: "Missing gameweekFplId" };
    }

    const gwMeta = await resolveGameweekMeta(gameweekFplId, null, db);
    const resolvedCancherosId = cancherosId || (await resolveCancherosId(db));

    if (gwMeta && resolvedCancherosId) {
      const alreadySent = await hasNotified(
        resolvedCancherosId,
        gwMeta.id,
        NOTIFICATION_EVENT.DEADLINE_4H,
        db
      );
      if (alreadySent) {
        console.log(
          `[tg:notify-deadline] GW${gameweekFplId} skipped (already notified per notification_log)`
        );
        return {
          sent: 0,
          failed: 0,
          skipped: true,
          reason: "Already notified (notification_log)",
          gameweekFplId,
          hoursLeft,
        };
      }
    }

    const members = await getRegisteredMembers();
    if (members.length === 0) {
      return { sent: 0, failed: 0, reason: "No registered members" };
    }

    const deadlineLabel =
      deadlineTime instanceof Date
        ? formatEthiopianDateTime(deadlineTime)
        : "";

    const hours =
      typeof hoursLeft === "number" ? Math.max(0, hoursLeft) : null;
    const hoursText =
      hours != null
        ? hours === 1
          ? "1 hour"
          : `${hours} hours`
        : "a few hours";

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const member of members) {
      try {
        const lines = [
          `⏰ GW${gameweekFplId} — ${hoursText} left to deadline`,
        ];
        if (gameweekName) lines[0] += ` (${gameweekName})`;
        lines.push("");
        lines.push("Time for a final check:");
        lines.push("  • Captaincy locked in?");
        lines.push("  • Transfers confirmed?");
        lines.push("  • Any injuries or suspensions?");
        if (deadlineLabel) {
          lines.push("");
          lines.push(`Deadline: ${deadlineLabel}`);
        }

        const body = lines.join("\n");
        const res = await sendDm(member.telegramUserId, body);
        if (res.ok) sent++;
        else if (!res.skipped) {
          failed++;
          if (res.error) errors.push({ member: member.memberId, err: res.error });
        }
      } catch (err) {
        failed++;
        errors.push({ member: member.memberId, err: err.message || String(err) });
      }
    }

    if (gwMeta && resolvedCancherosId) {
      await markNotified(
        {
          cancherosId: resolvedCancherosId,
          gameweekId: gwMeta.id,
          eventType: NOTIFICATION_EVENT.DEADLINE_4H,
          sent,
          failed,
          errors: errors.length > 0 ? errors : null,
        },
        db
      );
    }

    console.log(
      `[tg:notify-deadline] GW${gameweekFplId} sent=${sent} failed=${failed}`
    );
    return { sent, failed, gameweekFplId, hoursLeft: hours, idempotent: Boolean(gwMeta && resolvedCancherosId) };
  } catch (err) {
    console.error(
      "[tg:notify-deadline] failed:",
      err.message || String(err)
    );
    return { sent: 0, failed: 0, error: err.message || String(err) };
  }
}
