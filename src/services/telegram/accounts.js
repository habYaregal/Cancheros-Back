import { pool } from "../../config/database.js";
import { getClassicLeagueStandings } from "../fpl/fpl.client.js";
import { getCancherosLeague } from "../cancheros/cancheros.js";
import { addCancherosMember } from "../cancheros/cancheros.members.js";
import { getSeasonLeaderboard } from "../competitions/season.js";
import { getWeeklyLeaderboard } from "../competitions/weekly.js";
import { getH2HStandings } from "../competitions/h2h.js";

export async function upsertTelegramAccount(telegramUser, db = pool) {
  const result = await db.query(
    `
    INSERT INTO telegram_accounts (
      telegram_user_id,
      username,
      first_name,
      last_name,
      language_code,
      photo_url,
      last_seen_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (telegram_user_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      language_code = EXCLUDED.language_code,
      photo_url = COALESCE(EXCLUDED.photo_url, telegram_accounts.photo_url),
      last_seen_at = NOW()
    RETURNING *;
    `,
    [
      telegramUser.id,
      telegramUser.username || null,
      telegramUser.first_name || null,
      telegramUser.last_name || null,
      telegramUser.language_code || null,
      telegramUser.photo_url || null,
    ]
  );

  return result.rows[0];
}

export async function getTelegramProfile(telegramUser, db = pool) {
  const account = await upsertTelegramAccount(telegramUser, db);
  return buildProfile(account, db);
}

export async function getRegisteredMembers(db = pool) {
  const result = await db.query(
    `
    SELECT
      ta.telegram_user_id,
      ta.username,
      ta.first_name AS telegram_first_name,
      ta.last_name AS telegram_last_name,
      ta.photo_url,
      ta.last_seen_at,
      cm.id AS member_id,
      cm.display_name,
      fm.fpl_id,
      fm.first_name,
      fm.last_name,
      fm.team_name
    FROM telegram_accounts ta
    JOIN cancheros_members cm ON cm.id = ta.member_id
    JOIN fpl_managers fm ON fm.id = cm.manager_id
    WHERE cm.active = true
    ORDER BY fm.last_name ASC, fm.first_name ASC;
    `
  );

  return result.rows.map((row) => ({
    telegramUserId: Number(row.telegram_user_id),
    username: row.username,
    telegramFirstName: row.telegram_first_name,
    telegramLastName: row.telegram_last_name,
    photoUrl: row.photo_url,
    lastSeenAt: row.last_seen_at,
    memberId: Number(row.member_id),
    displayName: row.display_name,
    fplId: row.fpl_id,
    firstName: row.first_name,
    lastName: row.last_name,
    teamName: row.team_name,
  }));
}

export async function linkTelegramToFpl(telegramUser, fplIdRaw, db = pool) {
  const fplId = Number(fplIdRaw);

  if (!Number.isInteger(fplId) || fplId <= 0) {
    const error = new Error("Enter a valid FPL team ID.");
    error.status = 400;
    throw error;
  }

  const account = await upsertTelegramAccount(telegramUser, db);

  if (account.member_id) {
    const error = new Error("This Telegram account is already linked to a Cancheros manager.");
    error.status = 409;
    throw error;
  }

  const member = await findOrClaimMember(fplId, db);

  const taken = await db.query(
    `
    SELECT telegram_user_id
    FROM telegram_accounts
    WHERE member_id = $1
      AND telegram_user_id <> $2;
    `,
    [member.id, telegramUser.id]
  );

  if (taken.rows.length > 0) {
    const error = new Error(
      "That FPL team is already linked to another Telegram account."
    );
    error.status = 409;
    throw error;
  }

  const linked = await db.query(
    `
    UPDATE telegram_accounts
    SET member_id = $1, last_seen_at = NOW()
    WHERE telegram_user_id = $2
    RETURNING *;
    `,
    [member.id, telegramUser.id]
  );

  return buildProfile(linked.rows[0], db);
}

async function findOrClaimMember(fplId, db) {
  const existing = await db.query(
    `
    SELECT cm.id, cm.active, fm.fpl_id
    FROM cancheros_members cm
    JOIN fpl_managers fm ON fm.id = cm.manager_id
    JOIN cancheros c ON c.id = cm.cancheros_id
    WHERE c.name = 'Cancheros'
      AND fm.fpl_id = $1
    LIMIT 1;
    `,
    [fplId]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const cancheros = await getCancherosLeague(db);
  const { standings } = await getClassicLeagueStandings(
    cancheros.fpl_league_id
  );
  const inLeague = standings.some((row) => Number(row.entry) === fplId);

  if (!inLeague) {
    const error = new Error(
      "That FPL team is not in the Cancheros league. Join the FPL mini-league first, then come back."
    );
    error.status = 403;
    throw error;
  }

  const created = await addCancherosMember(fplId, {}, db);
  return { id: created.id, active: true, fpl_id: fplId };
}

async function buildProfile(account, db) {
  const telegram = {
    id: Number(account.telegram_user_id),
    username: account.username,
    firstName: account.first_name,
    lastName: account.last_name,
    photoUrl: account.photo_url,
  };

  if (!account.member_id) {
    return {
      linked: false,
      telegram,
      member: null,
      snapshot: null,
    };
  }

  const memberResult = await db.query(
    `
    SELECT
      cm.id AS member_id,
      cm.display_name,
      cm.participation_start_gw,
      cm.active,
      cm.joined_at,
      fm.id AS manager_id,
      fm.fpl_id,
      fm.first_name,
      fm.last_name,
      fm.team_name,
      fm.country
    FROM cancheros_members cm
    JOIN fpl_managers fm ON fm.id = cm.manager_id
    WHERE cm.id = $1
    LIMIT 1;
    `,
    [account.member_id]
  );

  const row = memberResult.rows[0];
  if (!row) {
    return { linked: false, telegram, member: null, snapshot: null };
  }

  const member = {
    memberId: row.member_id,
    managerId: row.manager_id,
    fplId: row.fpl_id,
    firstName: row.first_name,
    lastName: row.last_name,
    teamName: row.team_name,
    displayName: row.display_name,
    country: row.country,
    participationStartGw: row.participation_start_gw,
    active: row.active,
    joinedAt: row.joined_at,
  };

  return {
    linked: true,
    telegram,
    member,
    snapshot: await getMemberSnapshot(member.memberId, db),
  };
}

async function getMemberSnapshot(memberId, db) {
  const seasonRow = await db.query(`
    SELECT id, name
    FROM seasons
    WHERE is_current = true
    ORDER BY id DESC
    LIMIT 1;
  `);

  const gwRow = await db.query(`
    SELECT fpl_id
    FROM gameweeks
    WHERE is_current = true
    LIMIT 1;
  `);

  const cancheros = await getCancherosLeague(db);
  const seasonId = seasonRow.rows[0]?.id;
  const gameweek = gwRow.rows[0]?.fpl_id ?? null;

  let season = null;
  if (seasonId) {
    const board = await getSeasonLeaderboard(seasonId, db);
    season = rankOnBoard(board, memberId, ["points", "gameweeks_played"]);
    if (season) season.seasonName = seasonRow.rows[0].name;
  }

  let weekly = null;
  if (gameweek) {
    const board = await getWeeklyLeaderboard(gameweek, db);
    weekly = rankOnBoard(board, memberId, ["points"]);
    if (weekly) weekly.gameweek = gameweek;
  }

  const h2hBoard = await getH2HStandings(cancheros.id, db);
  const h2h = rankOnBoard(h2hBoard, memberId, [
    "points",
    "played",
    "wins",
    "draws",
    "losses",
  ]);

  let nextMatch = null;
  try {
    nextMatch = await getUpcomingH2HMatch(cancheros.id, memberId, gameweek, db);
  } catch {
    nextMatch = null;
  }

  return { season, weekly, h2h, nextMatch };
}

function rankOnBoard(board, memberId, keys) {
  const index = board.findIndex((row) => Number(row.member_id) === Number(memberId));
  if (index < 0) return null;

  const row = board[index];
  const extra = {};
  for (const key of keys) extra[key] = row[key];

  return {
    position: index + 1,
    ...extra,
  };
}

async function getUpcomingH2HMatch(cancherosId, memberId, gameweek, db) {
  if (!gameweek) return null;

  const result = await db.query(
    `
    SELECT
      hm.id,
      hm.is_bye,
      g.fpl_id AS gameweek,
      p1.id AS player_one_member_id,
      p1_fm.first_name AS player_one_first_name,
      p1_fm.last_name AS player_one_last_name,
      p2.id AS player_two_member_id,
      p2_fm.first_name AS player_two_first_name,
      p2_fm.last_name AS player_two_last_name
    FROM h2h_matches hm
    JOIN h2h_rounds hr ON hr.id = hm.round_id
    JOIN gameweeks g ON g.id = hr.gameweek_id
    LEFT JOIN cancheros_members p1 ON p1.id = hm.player_one_id
    LEFT JOIN fpl_managers p1_fm ON p1_fm.id = p1.manager_id
    LEFT JOIN cancheros_members p2 ON p2.id = hm.player_two_id
    LEFT JOIN fpl_managers p2_fm ON p2_fm.id = p2.manager_id
    WHERE hr.cancheros_id = $1
      AND g.fpl_id = $2
      AND (hm.player_one_id = $3 OR hm.player_two_id = $3)
    LIMIT 1;
    `,
    [cancherosId, gameweek, memberId]
  );

  const row = result.rows[0];
  if (!row) return null;

  if (row.is_bye) {
    return { gameweek: row.gameweek, isBye: true, opponent: null };
  }

  const iAmPlayerOne = Number(row.player_one_member_id) === Number(memberId);
  const opponent = iAmPlayerOne
    ? {
        memberId: row.player_two_member_id,
        firstName: row.player_two_first_name,
        lastName: row.player_two_last_name,
      }
    : {
        memberId: row.player_one_member_id,
        firstName: row.player_one_first_name,
        lastName: row.player_one_last_name,
      };

  return { gameweek: row.gameweek, isBye: false, opponent };
}
