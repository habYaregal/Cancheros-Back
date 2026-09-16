import { runMigrations } from "./runMigrations.js";
import { pool } from "../config/database.js";

async function migrate() {
  try {
    await runMigrations();
    console.log("Database migration completed successfully.");
  } catch (error) {
    console.error("Migration failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();