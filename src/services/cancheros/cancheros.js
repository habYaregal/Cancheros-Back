import { pool } from "../../config/database.js";

export async function getCancherosLeague(db = pool) {
  const result = await db.query(
    `
    SELECT
      id,
      name,
      fpl_league_id,
      max_members,
      start_gameweek,
      created_at
    FROM cancheros
    WHERE name = 'Cancheros'
    LIMIT 1;
    `
  );

  if (result.rows.length === 0) {
    const error = new Error("Cancheros league not found.");
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}

export async function getCancherosManagers(db = pool) {
  const cancheros = await getCancherosLeague(db);

  const result = await db.query(
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
    JOIN fpl_managers fm
      ON fm.id = cm.manager_id
    WHERE cm.cancheros_id = $1
    ORDER BY cm.id;
    `,
    [cancheros.id]
  );

  return {
    cancheros,
    managers: result.rows,
  };
}
