import { pool } from "../../config/database.js";
import { syncFplManager } from "../fpl/fpl.manager.sync.js";
import { getClassicLeagueStandings } from "../fpl/fpl.client.js";

export const CANCHEROS_FPL_LEAGUE_ID = 696420;

export async function addCancherosMember(
  entryId,
  options = {},
  db = pool
) {
  const {
    participationStartGw = null,
    displayName = null,
  } = options;

  const client = db === pool ? await pool.connect() : db;
  const shouldRelease = db === pool;

  try {
    if (shouldRelease) {
      await client.query("BEGIN");
    }

    const manager = await syncFplManager(entryId, client);

    const cancherosResult = await client.query(
      `
      SELECT id, max_members, start_gameweek
      FROM cancheros
      WHERE fpl_league_id = $1;
      `,
      [CANCHEROS_FPL_LEAGUE_ID]
    );

    if (cancherosResult.rows.length === 0) {
      throw new Error("Cancheros league was not found.");
    }

    const cancheros = cancherosResult.rows[0];

    const countResult = await client.query(
      `
      SELECT COUNT(*)::INTEGER AS count
      FROM cancheros_members
      WHERE cancheros_id = $1;
      `,
      [cancheros.id]
    );

    const currentMemberCount = countResult.rows[0].count;

    const existingMember = await client.query(
      `
      SELECT id, participation_start_gw, active
      FROM cancheros_members
      WHERE cancheros_id = $1
        AND manager_id = $2;
      `,
      [cancheros.id, manager.id]
    );

    const isNew = existingMember.rows.length === 0;

    if (isNew && currentMemberCount >= cancheros.max_members) {
      throw new Error(
        `Cancheros has reached its maximum of ${cancheros.max_members} members.`
      );
    }

    const startGw =
      isNew
        ? (participationStartGw ??
          (await getCurrentOrStartGameweek(
            cancheros.start_gameweek,
            client
          )))
        : existingMember.rows[0].participation_start_gw;

    const memberResult = await client.query(
      `
      INSERT INTO cancheros_members (
        cancheros_id,
        manager_id,
        display_name,
        participation_start_gw,
        active
      )
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (cancheros_id, manager_id)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        active = true
      RETURNING *;
      `,
      [
        cancheros.id,
        manager.id,
        displayName || manager.team_name,
        startGw,
      ]
    );

    if (shouldRelease) {
      await client.query("COMMIT");
    }

    return {
      ...memberResult.rows[0],
      created: isNew,
      manager,
    };
  } catch (error) {
    if (shouldRelease) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

/**
 * Pull the official FPL classic-league roster and
 * reconcile Cancheros membership.
 *
 * - New FPL entries → added (active)
 * - Existing entries → refreshed / reactivated
 * - Local members missing from FPL → marked inactive
 */
export async function syncCancherosMembersFromFpl(
  db = pool
) {
  const cancherosResult = await db.query(
    `
    SELECT id, name, fpl_league_id, max_members, start_gameweek
    FROM cancheros
    WHERE fpl_league_id = $1
    LIMIT 1;
    `,
    [CANCHEROS_FPL_LEAGUE_ID]
  );

  if (cancherosResult.rows.length === 0) {
    throw new Error("Cancheros league was not found.");
  }

  const cancheros = cancherosResult.rows[0];

  const { league, standings } =
    await getClassicLeagueStandings(cancheros.fpl_league_id);

  if (standings.length > cancheros.max_members) {
    throw new Error(
      `FPL league has ${standings.length} members, ` +
        `but Cancheros max is ${cancheros.max_members}.`
    );
  }

  const currentGw = await getCurrentOrStartGameweek(
    cancheros.start_gameweek,
    db
  );

  const added = [];
  const updated = [];
  const fplEntryIds = [];

  for (const row of standings) {
    fplEntryIds.push(row.entry);

    const member = await addCancherosMember(
      row.entry,
      {
        participationStartGw: currentGw,
        displayName: row.entry_name,
      },
      db
    );

    const summary = {
      fplId: row.entry,
      playerName: row.player_name,
      teamName: row.entry_name,
      memberId: member.id,
      participationStartGw: member.participation_start_gw,
    };

    if (member.created) {
      added.push(summary);
    } else {
      updated.push(summary);
    }
  }

  const deactivatedResult = await db.query(
    `
    UPDATE cancheros_members cm
    SET active = false
    FROM fpl_managers fm
    WHERE cm.manager_id = fm.id
      AND cm.cancheros_id = $1
      AND cm.active = true
      AND NOT (fm.fpl_id = ANY($2::integer[]))
    RETURNING
      cm.id AS member_id,
      fm.fpl_id,
      fm.first_name,
      fm.last_name,
      fm.team_name;
    `,
    [cancheros.id, fplEntryIds]
  );

  const membersResult = await db.query(
    `
    SELECT
      cm.id AS member_id,
      cm.active,
      cm.participation_start_gw,
      cm.display_name,
      fm.fpl_id,
      fm.first_name,
      fm.last_name,
      fm.team_name
    FROM cancheros_members cm
    JOIN fpl_managers fm
      ON fm.id = cm.manager_id
    WHERE cm.cancheros_id = $1
    ORDER BY cm.active DESC, fm.last_name ASC, fm.first_name ASC;
    `,
    [cancheros.id]
  );

  return {
    cancheros: cancheros.name,
    fplLeagueId: cancheros.fpl_league_id,
    fplLeagueName: league?.name || null,
    fplMemberCount: standings.length,
    added,
    updated,
    deactivated: deactivatedResult.rows.map((row) => ({
      memberId: row.member_id,
      fplId: row.fpl_id,
      firstName: row.first_name,
      lastName: row.last_name,
      teamName: row.team_name,
    })),
    members: membersResult.rows,
  };
}

async function getCurrentOrStartGameweek(startGameweek, db) {
  const result = await db.query(`
    SELECT fpl_id
    FROM gameweeks
    WHERE is_current = true
    LIMIT 1;
  `);

  if (result.rows.length > 0) {
    return result.rows[0].fpl_id;
  }

  return startGameweek;
}
