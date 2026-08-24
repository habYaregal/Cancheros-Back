import { getWeeklyLeaderboard } from "./weekly.js";

export async function getWeeklyWinner(gameweekFplId, db) {
  const leaderboard = await getWeeklyLeaderboard(
    gameweekFplId,
    db
  );

  if (leaderboard.length === 0) {
    return {
      gameweek: gameweekFplId,
      winner: null,
      winners: [],
      message: "No scores available yet."
    };
  }

  const highestScore = leaderboard[0].points;

  const winners = leaderboard.filter(
    (manager) => manager.points === highestScore
  );

  return {
    gameweek: gameweekFplId,
    winner: winners.length === 1 ? winners[0] : null,
    winners,
    tied: winners.length > 1
  };
}