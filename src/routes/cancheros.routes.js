import { Router } from "express";
import { asyncHandler } from "../middleware/errors.js";
import { getCancherosLeague } from "../services/cancheros/cancheros.js";
import { syncCancherosMembersFromFpl } from "../services/cancheros/cancheros.members.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const cancheros = await getCancherosLeague();

    res.json({
      id: cancheros.id,
      name: cancheros.name,
      fplLeagueId: cancheros.fpl_league_id,
      maxMembers: cancheros.max_members,
      startGameweek: cancheros.start_gameweek,
      createdAt: cancheros.created_at,
    });
  })
);

router.post(
  "/sync-members",
  asyncHandler(async (req, res) => {
    const result = await syncCancherosMembersFromFpl();

    res.json({
      fplLeagueId: result.fplLeagueId,
      fplLeagueName: result.fplLeagueName,
      fplMemberCount: result.fplMemberCount,
      added: result.added,
      updated: result.updated,
      deactivated: result.deactivated,
      members: result.members.map((row) => ({
        memberId: row.member_id,
        active: row.active,
        fplId: row.fpl_id,
        firstName: row.first_name,
        lastName: row.last_name,
        teamName: row.team_name,
        displayName: row.display_name,
        participationStartGw: row.participation_start_gw,
      })),
    });
  })
);

export default router;
