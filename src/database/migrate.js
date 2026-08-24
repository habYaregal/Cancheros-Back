import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsPath = path.join(
  __dirname,
  "../../database/migrations"
);

async function migrate() {
  const client = await pool.connect();

  try {
    console.log("Starting database migration...");

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const files = fs
      .readdirSync(migrationsPath)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const existing = await client.query(
        `SELECT id FROM schema_migrations WHERE filename = $1`,
        [file]
      );

      if (existing.rows.length > 0) {
        console.log(`✓ Skipping ${file}`);
        continue;
      }

      console.log(`→ Running ${file}`);

      const sql = fs.readFileSync(
        path.join(migrationsPath, file),
        "utf8"
      );

      await client.query("BEGIN");

      try {
        await client.query(sql);

        await client.query(
          `INSERT INTO schema_migrations (filename)
           VALUES ($1)`,
          [file]
        );

        await client.query("COMMIT");

        console.log(`✓ Completed ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("Database migration completed successfully.");
  } catch (error) {
    console.error("Migration failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();