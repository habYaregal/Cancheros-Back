import { parseTelegramInitData } from "../services/telegram/initData.js";

export function requireTelegramUser(req, res, next) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const initData =
    req.get("x-telegram-init-data") ||
    (req.get("authorization") || "").replace(/^tma\s+/i, "") ||
    req.body?.initData;

  try {
    const parsed = parseTelegramInitData(initData, botToken);
    req.telegramUser = parsed.user;
    next();
  } catch (error) {
    next(error);
  }
}
