import axios from "axios";

const fplClient = axios.create({
  baseURL: "https://fantasy.premierleague.com/api",
  timeout: 10000,
});

export async function getBootstrapStatic() {
  const response = await fplClient.get("/bootstrap-static/");
  return response.data;
}

export async function getManager(entryId) {
  const response = await fplClient.get(`/entry/${entryId}/`);
  return response.data;
}

export async function getManagerHistory(entryId) {
  const response = await fplClient.get(`/entry/${entryId}/history/`);
  return response.data;
}

export async function getManagerPicks(entryId, gameweek) {
  const response = await fplClient.get(
    `/entry/${entryId}/event/${gameweek}/picks/`
  );

  return response.data;
}

export async function getClassicLeague(leagueId, page = 1) {
  const response = await fplClient.get(
    `/leagues-classic/${leagueId}/standings/`,
    {
      params: {
        page_standings: page,
      },
    }
  );

  return response.data;
}

/**
 * Fetch every standings page for a classic league.
 */
export async function getClassicLeagueStandings(leagueId) {
  const firstPage = await getClassicLeague(leagueId, 1);
  const results = [...(firstPage.standings?.results || [])];

  let page = 1;
  let hasNext = Boolean(firstPage.standings?.has_next);

  while (hasNext) {
    page += 1;
    const nextPage = await getClassicLeague(leagueId, page);
    results.push(...(nextPage.standings?.results || []));
    hasNext = Boolean(nextPage.standings?.has_next);
  }

  return {
    league: firstPage.league,
    standings: results,
  };
}