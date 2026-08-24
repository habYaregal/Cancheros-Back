import { getBootstrapStatic } from "./services/fpl/fpl.client.js";

async function test() {
  try {
    const data = await getBootstrapStatic();

    console.log("FPL connection successful.");

    console.log("Gameweeks:", data.events.length);
    console.log("Teams:", data.teams.length);
    console.log("Players:", data.elements.length);

    console.log("\nFirst gameweek:");
    console.dir(data.events[0], { depth: null });

    console.log("\nFirst team:");
    console.dir(data.teams[0], { depth: null });

    console.log("\nFirst player:");
    console.dir(data.elements[0], { depth: null });
  } catch (error) {
    console.error("FPL request failed.");

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    } else {
      console.error(error.message);
    }
  }
}

test();