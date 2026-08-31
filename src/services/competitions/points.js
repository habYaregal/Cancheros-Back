/**
 * Effective gameweek points derived from FPL cumulative totals.
 * Used for season/monthly standings where penalties reduce total_points
 * but not always the raw GW points field.
 */
export const gameweekPointsSql = `
  COALESCE(
    mgs.total_points - COALESCE(
      (
        SELECT prev.total_points
        FROM manager_gameweek_scores prev
        JOIN gameweeks pg
          ON pg.id = prev.gameweek_id
        WHERE prev.manager_id = mgs.manager_id
          AND pg.season_id = g.season_id
          AND pg.fpl_id = g.fpl_id - 1
        LIMIT 1
      ),
      0
    ),
    mgs.points,
    0
  )
`;
