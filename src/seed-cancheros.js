import { pool } from "./config/database.js";
import { addCancherosMember } from "./services/cancheros/cancheros.members.js";

const MEMBERS = [
  3142173,
  5483704,
  3676616,
];

async function seed() {
  try {
    console.log("================================");
    console.log("Seeding Cancheros members");
    console.log("================================");

    for (const entryId of MEMBERS) {
      console.log(`\nSyncing FPL entry ${entryId}...`);

      const member = await addCancherosMember(entryId);

      console.log("Member added:");
      console.dir(member, { depth: null });
    }

    console.log("\n================================");
    console.log("Cancheros seed completed.");
    console.log("================================");
  } catch (error) {
    console.error("Cancheros seed failed:");
    console.error(error);

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();