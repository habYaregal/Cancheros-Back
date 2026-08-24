import { getSeasonLeaderboard } from "./season.js";

export async function getSeasonWinner(
  seasonId,
  db
) {
  const leaderboard = await getSeasonLeaderboard(
    seasonId,
    db
  );

  if (leaderboard.length === 0) {
    return {
      season: seasonId,
      winner: null,
      winners: [],
      tied: false,
      message: "No participants found."
    };
  }

  const activeManagers = leaderboard.filter(
    (manager) => manager.gameweeks_played > 0
  );

  if (activeManagers.length === 0) {
    return {
      season: seasonId,
      winner: null,
      winners: [],
      tied: false,
      message: "No scores available yet."
    };
  }

  const highestScore = activeManagers[0].points;

  const winners = activeManagers.filter(
    (manager) => manager.points === highestScore
  );

  return {
    season: seasonId,
    winner: winners.length === 1 ? winners[0] : null,
    winners,
    tied: winners.length > 1
  };
}