import { Router } from "express";
import { asyncHandler } from "../middleware/errors.js";
import { pool } from "../config/database.js";
import { getCancherosManagers } from "../services/cancheros/cancheros.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { managers } = await getCancherosManagers();

    res.json({
      count: managers.length,
      managers: managers.map((manager) => ({
        memberId: manager.member_id,
        managerId: manager.manager_id,
        fplId: manager.fpl_id,
        firstName: manager.first_name,
        lastName: manager.last_name,
        teamName: manager.team_name,
        displayName: manager.display_name,
        country: manager.country,
        participationStartGw: manager.participation_start_gw,
        active: manager.active,
        joinedAt: manager.joined_at,
      })),
    });
  })
);

router.get(
  "/:fplId",
  asyncHandler(async (req, res) => {
    const fplId = Number(req.params.fplId);

    if (Number.isNaN(fplId)) {
      const error = new Error("Invalid manager id.");
      error.status = 400;
      throw error;
    }

    const result = await pool.query(
      `
      SELECT
        cm.id AS member_id,
        cm.display_name,
        cm.participation_start_gw,
        cm.active,
        cm.joined_at,
        fm.id AS manager_id,
        fm.fpl_id,
        fm.first_name,
        fm.last_name,
        fm.team_name,
        fm.country
      FROM cancheros_members cm
      JOIN fpl_managers fm
        ON fm.id = cm.manager_id
      JOIN cancheros c
        ON c.id = cm.cancheros_id
      WHERE c.name = 'Cancheros'
        AND fm.fpl_id = $1
      LIMIT 1;
      `,
      [fplId]
    );

    if (result.rows.length === 0) {
      const error = new Error("Manager not found.");
      error.status = 404;
      throw error;
    }

    const manager = result.rows[0];

    res.json({
      memberId: manager.member_id,
      managerId: manager.manager_id,
      fplId: manager.fpl_id,
      firstName: manager.first_name,
      lastName: manager.last_name,
      teamName: manager.team_name,
      displayName: manager.display_name,
      country: manager.country,
      participationStartGw: manager.participation_start_gw,
      active: manager.active,
      joinedAt: manager.joined_at,
    });
  })
);

export default router;
