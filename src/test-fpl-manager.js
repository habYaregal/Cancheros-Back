import {
  getManager,
  getManagerHistory,
  getManagerPicks,
} from "./services/fpl/fpl.client.js";

const ENTRY_ID = 3142173; // replace locally with your FPL entry ID

async function test() {
  try {
    console.log("========== MANAGER ==========");

    const manager = await getManager(ENTRY_ID);

    console.dir(manager, { depth: null });

    console.log("\n========== HISTORY ==========");

    const history = await getManagerHistory(ENTRY_ID);

    console.dir(history, { depth: null });

    console.log("\n========== GW1 PICKS ==========");

    const picks = await getManagerPicks(ENTRY_ID, 1);

    console.dir(picks, { depth: null });
  } catch (error) {
    console.error("FPL manager request failed.");

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

test();