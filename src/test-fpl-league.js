import { getClassicLeague } from "./services/fpl/fpl.client.js";

const CANCheros_FPL_LEAGUE_ID = 696420;

async function test() {
  try {
    console.log("========== CANCHEROS FPL LEAGUE ==========");

    const league = await getClassicLeague(CANCheros_FPL_LEAGUE_ID);

    console.log("League:");
    console.dir(league.league, { depth: null });

    console.log("\nStandings:");
    console.dir(league.standings, { depth: null });
  } catch (error) {
    console.error("FPL league request failed.");

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

test();