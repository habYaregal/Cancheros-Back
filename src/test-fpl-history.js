import { getManagerHistory } from "./services/fpl/fpl.client.js";

const ENTRY_ID = 3142173;

async function test() {
  try {
    console.log("========== FPL MANAGER HISTORY ==========");

    const history = await getManagerHistory(ENTRY_ID);

    console.log("\nCurrent:");
    console.dir(history.current, { depth: null });

    console.log("\nPast:");
    console.dir(history.past, { depth: null });

    console.log("\nChips:");
    console.dir(history.chips, { depth: null });
  } catch (error) {
    console.error("FPL history request failed.");

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

test();