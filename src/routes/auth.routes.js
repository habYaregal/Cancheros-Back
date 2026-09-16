import { Router } from "express";
import { asyncHandler } from "../middleware/errors.js";
import { requireTelegramUser } from "../middleware/telegramAuth.js";
import {
  getRegisteredMembers,
  getTelegramProfile,
  linkTelegramToFpl,
} from "../services/telegram/accounts.js";

const router = Router();

router.get(
  "/me",
  requireTelegramUser,
  asyncHandler(async (req, res) => {
    const profile = await getTelegramProfile(req.telegramUser);
    res.json(profile);
  })
);

router.get(
  "/members",
  requireTelegramUser,
  asyncHandler(async (req, res) => {
    const members = await getRegisteredMembers();
    res.json({ members });
  })
);

router.post(
  "/register",
  requireTelegramUser,
  asyncHandler(async (req, res) => {
    const profile = await linkTelegramToFpl(
      req.telegramUser,
      req.body?.fplId
    );
    res.json(profile);
  })
);

export default router;
