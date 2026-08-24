import { pool } from "../config/database.js";

async function assignCompetitionMonths() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(`
      UPDATE gameweeks g
      SET competition_month_id = cm.id
      FROM competition_months cm
      WHERE g.deadline_time::date
        BETWEEN cm.start_date AND cm.end_date
        AND g.season_id = cm.season_id;
    `);

    await client.query("COMMIT");

    console.log(
      `Assigned competition months to ${result.rowCount} gameweeks.`
    );

    const verification = await client.query(`
      SELECT
        g.fpl_id AS gameweek,
        g.name,
        cm.name AS month
      FROM gameweeks g
      JOIN competition_months cm
        ON cm.id = g.competition_month_id
      ORDER BY g.fpl_id;
    `);

    console.table(verification.rows);
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Failed to assign competition months:");
    console.error(error);
  } finally {
    client.release();
    await pool.end();
  }
}

assignCompetitionMonths();