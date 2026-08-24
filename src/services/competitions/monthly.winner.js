import { getMonthlyLeaderboard } from "./monthly.js";

export async function getMonthlyWinner(
  competitionMonthId,
  db
) {
  const leaderboard = await getMonthlyLeaderboard(
    competitionMonthId,
    db
  );

  if (leaderboard.length === 0) {
    return {
      month: competitionMonthId,
      winner: null,
      winners: [],
      tied: false,
      message: "No participants found."
    };
  }

  /*
   * A manager must have played at least one
   * gameweek in the competition period.
   */
  const activeManagers = leaderboard.filter(
    (manager) => manager.gameweeks_played > 0
  );

  if (activeManagers.length === 0) {
    return {
      month: competitionMonthId,
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
    month: competitionMonthId,
    winner: winners.length === 1 ? winners[0] : null,
    winners,
    tied: winners.length > 1
  };
}