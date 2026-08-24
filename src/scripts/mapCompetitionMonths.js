import { pool } from "../config/database.js";

async function mapCompetitionMonths() {
  const client = await pool.connect();

  try {
    const result = await client.query(`
      SELECT
        g.id,
        g.fpl_id,
        g.name,
        g.deadline_time,
        cm.id AS month_id,
        cm.name AS month_name
      FROM gameweeks g
      LEFT JOIN competition_months cm
        ON g.deadline_time::date
           BETWEEN cm.start_date AND cm.end_date
      ORDER BY g.fpl_id;
    `);

    console.table(
      result.rows.map((row) => ({
        gameweek: row.fpl_id,
        name: row.name,
        deadline: row.deadline_time,
        month: row.month_name,
        monthId: row.month_id,
      }))
    );
  } catch (error) {
    console.error("Failed:", error);
  } finally {
    client.release();
    await pool.end();
  }
}

mapCompetitionMonths();