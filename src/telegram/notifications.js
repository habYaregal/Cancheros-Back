import { pool } from "../config/database.js";
import { formatEthiopianDateTime } from "../config/time.js";
import { getBot } from "./bot.js";
import { getRegisteredMembers } from "../services/telegram/accounts.js";
import { getH2HStandings } from "../services/competitions/h2h.js";

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

export async function notifyH2HDraw({ roundId, gameweek, cancherosId }) {
  const bot = getBot();
  if (!bot) {
    return { sent: 0, failed: 0, skipped: true, reason: "Bot not started" };
  }

  try {
    const gwFplId = gameweek?.fplId ?? gameweek?.fpl_id;
    if (!roundId || !gwFplId) {
      return { sent: 0, failed: 0, reason: "Missing roundId or gameweek" };
    }

    const [members, matches] = await Promise.all([
      getRegisteredMembers(),
      getRoundMatchesWithMembers(roundId),
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
        else if (!res.skipped) failed++;
      } catch (err) {
        failed++;
      }
    }

    console.log(
      `[tg:notify-h2h-draw] GW${gwFplId} sent=${sent} failed=${failed}`
    );
    return { sent, failed, roundId, gameweek: gwFplId };
  } catch (err) {
    console.error("[tg:notify-h2h-draw] failed:", err.message || String(err));
    return { sent: 0, failed: 0, error: err.message || String(err) };
  }
}

export async function notifyGameweekEnd({
  gameweekFplId,
  roundId,
  cancherosId,
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

    const [members, standingsRaw, matches] = await Promise.all([
      getRegisteredMembers(),
      cancherosId ? getH2HStandings(cancherosId, db) : [],
      roundId ? getRoundMatchesWithMembers(roundId, db) : [],
    ]);

    if (members.length === 0) {
      return { sent: 0, failed: 0, reason: "No registered members" };
    }

    const standings = standingsRaw.map((row, idx) => ({
      ...row,
      position: idx + 1,
    }));

    const top3 = standings.slice(0, 3).map((row) => {
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

    function standingForMember(memberId) {
      return standings.find(
        (row) => Number(row.member_id) === Number(memberId)
      );
    }

    let sent = 0;
    let failed = 0;

    for (const member of members) {
      try {
        const lines = [];
        lines.push(`🏁 GW${gameweekFplId} Complete`);
        lines.push("");

        const match = matchForMember(member.memberId);
        if (match) {
          if (match.is_bye) {
            lines.push("This week: BYE (+1.5 pts)");
          } else {
            const isP1 =
              Number(match.p1_member_id) === Number(member.memberId);
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

            let resultLabel = "D";
            if (myPts === 3) resultLabel = "W";
            else if (myPts === 0) resultLabel = "L";

            lines.push(
              `You ${resultLabel} vs ${oppFirstName} ${oppLastName}`
            );
            lines.push(
              `Score: ${Number(myScore) ?? "-"} — ${Number(oppScore) ?? "-"}`
            );
            lines.push(`H2H match points: +${myPts}`);
          }
          lines.push("");
        }

        const standing = standingForMember(member.memberId);
        if (standing) {
          const pd = Number(standing.points_difference) || 0;
          const pdSign = pd >= 0 ? "+" : "";
          lines.push(
            `H2H: #${standing.position} · ${standing.points} pts · PD ${pdSign}${pd}`
          );
          lines.push(
            `Record: ${standing.wins}W ${standing.draws}D ${standing.losses}L`
          );
        } else {
          lines.push("H2H: no ranking data yet");
        }

        if (top3.length > 0) {
          lines.push("");
          lines.push("Top 3:");
          for (const t of top3) lines.push(`  ${t}`);
        }

        const body = lines.join("\n");
        const res = await sendDm(member.telegramUserId, body);
        if (res.ok) sent++;
        else if (!res.skipped) failed++;
      } catch (err) {
        failed++;
      }
    }

    console.log(
      `[tg:notify-gw-end] GW${gameweekFplId} sent=${sent} failed=${failed}`
    );
    return { sent, failed, gameweekFplId, roundId: roundId ?? null };
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
}) {
  const bot = getBot();
  if (!bot) {
    return { sent: 0, failed: 0, skipped: true, reason: "Bot not started" };
  }

  try {
    if (!gameweekFplId) {
      return { sent: 0, failed: 0, reason: "Missing gameweekFplId" };
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
        else if (!res.skipped) failed++;
      } catch (err) {
        failed++;
      }
    }

    console.log(
      `[tg:notify-deadline] GW${gameweekFplId} sent=${sent} failed=${failed}`
    );
    return { sent, failed, gameweekFplId, hoursLeft: hours };
  } catch (err) {
    console.error(
      "[tg:notify-deadline] failed:",
      err.message || String(err)
    );
    return { sent: 0, failed: 0, error: err.message || String(err) };
  }
}
