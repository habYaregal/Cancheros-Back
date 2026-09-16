import { Bot, InlineKeyboard } from "grammy";
import {
  getTelegramProfile,
  linkTelegramToFpl,
} from "../services/telegram/accounts.js";

let bot = null;

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webAppUrl = process.env.TELEGRAM_WEBAPP_URL;

  if (!token) {
    console.log("Telegram bot skipped (TELEGRAM_BOT_TOKEN not set)");
    return null;
  }

  if (!webAppUrl) {
    console.warn(
      "Telegram bot skipped (TELEGRAM_WEBAPP_URL is required, e.g. https://your-app.vercel.app)"
    );
    return null;
  }

  bot = new Bot(token);

  const keyboard = new InlineKeyboard().webApp("Open Cancheros", webAppUrl);

  bot.command("start", async (ctx) => {
    const telegramUser = {
      id: ctx.from.id,
      username: ctx.from.username || null,
      first_name: ctx.from.first_name || null,
      last_name: ctx.from.last_name || null,
      language_code: ctx.from.language_code || null,
    };

    const profile = await getTelegramProfile(telegramUser);

    if (profile.linked) {
      const member = profile.member;
      await ctx.reply(
        [
          `Welcome back, ${member.firstName}.`,
          "",
          `You're linked to ${member.teamName} (FPL #${member.fplId}).`,
          "",
          "Open the Mini App to see standings, your personal dashboard, and this week's H2H match.",
          "",
          "Commands:",
          "/status — view your ranks",
          "/app — open the Mini App",
        ].join("\n"),
        { reply_markup: keyboard }
      );
      return;
    }

    await ctx.reply(
      [
        "Welcome to Cancheros.",
        "",
        "Tap below to open the Mini App, then register with your FPL team ID.",
        "Or send /register with your FPL ID or team URL.",
        "",
        "After registration, tables highlight your row and your profile shows ranks and this week's H2H.",
        "",
        "Commands:",
        "/register <FPL_ID> — link your FPL team",
        "/status — check your registration",
        "/app — open the Mini App",
      ].join("\n"),
      { reply_markup: keyboard }
    );
  });

  bot.command("app", async (ctx) => {
    await ctx.reply("Tap below to open the league.", {
      reply_markup: keyboard,
    });
  });

  bot.command("register", async (ctx) => {
    const text = ctx.match?.trim();
    const fplId = parseFplId(text);

    const telegramUser = {
      id: ctx.from.id,
      username: ctx.from.username || null,
      first_name: ctx.from.first_name || null,
      last_name: ctx.from.last_name || null,
      language_code: ctx.from.language_code || null,
    };

    if (!fplId) {
      const profile = await getTelegramProfile(telegramUser);
      if (profile.linked) {
        const member = profile.member;
        await ctx.reply(
          [
            `✅ Linked to ${member.firstName} ${member.lastName} (${member.teamName}).`,
            "",
            "Open the Mini App to see your highlighted rows and personal dashboard.",
          ].join("\n"),
          { reply_markup: keyboard }
        );
        return;
      }

      await ctx.reply(
        [
          "Send your FPL team ID or URL.",
          "",
          "Example: /register 1234567",
          "Or: /register https://fantasy.premierleague.com/entry/1234567/event/1",
        ].join("\n")
      );
      return;
    }

    try {
      const profile = await linkTelegramToFpl(telegramUser, fplId);
      const member = profile.member;
      await ctx.reply(
        [
          `✅ Linked to ${member.firstName} ${member.lastName} (${member.teamName}).`,
          "",
          "Open the Mini App to see your highlighted rows and personal dashboard.",
        ].join("\n"),
        { reply_markup: keyboard }
      );
    } catch (error) {
      const message =
        error.message ||
        "Could not register. Make sure your FPL team is in the Cancheros league.";
      await ctx.reply(`❌ ${message}`);
    }
  });

  bot.command("status", async (ctx) => {
    const telegramUser = {
      id: ctx.from.id,
      username: ctx.from.username || null,
      first_name: ctx.from.first_name || null,
      last_name: ctx.from.last_name || null,
      language_code: ctx.from.language_code || null,
    };

    try {
      const profile = await getTelegramProfile(telegramUser);

      if (!profile.linked) {
        await ctx.reply(
          [
            "You are not registered yet.",
            "",
            "Send /register (we'll try to match your Telegram username first).",
            "Or send /register <FPL_ID> with your team ID or team URL.",
          ].join("\n"),
          { reply_markup: keyboard }
        );
        return;
      }

      const { member, snapshot } = profile;
      const lines = [
        `✅ Registered as ${member.firstName} ${member.lastName}`,
        `Team: ${member.teamName}`,
        `FPL ID: ${member.fplId}`,
      ];

      if (snapshot?.season) {
        lines.push(`Season: #${snapshot.season.position} — ${snapshot.season.points} pts`);
      }
      if (snapshot?.weekly) {
        lines.push(`GW${snapshot.weekly.gameweek}: #${snapshot.weekly.position} — ${snapshot.weekly.points} pts`);
      }
      if (snapshot?.h2h) {
        const pd = snapshot.h2h.points_difference ?? 0;
        const pdSign = pd >= 0 ? "+" : "";
        lines.push(`H2H: #${snapshot.h2h.position} — ${snapshot.h2h.points} pts · PD ${pdSign}${pd} · ${snapshot.h2h.wins}W ${snapshot.h2h.draws}D ${snapshot.h2h.losses}L`);
      }
      if (snapshot?.nextMatch) {
        if (snapshot.nextMatch.isBye) {
          lines.push(`This week: BYE`);
        } else {
          const o = snapshot.nextMatch.opponent;
          lines.push(`This week: vs ${o?.firstName || ""} ${o?.lastName || ""}`.trim());
        }
      }

      await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
    } catch (error) {
      await ctx.reply(`❌ ${error.message || "Could not check your status."}`);
    }
  });

  bot.catch((err) => {
    console.error("Telegram bot error", err);
  });

  void bot.api
    .setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Cancheros",
        web_app: { url: webAppUrl },
      },
    })
    .catch((err) => {
      console.warn("Could not set Telegram menu button", err.message);
    });

  bot.start({
    onStart: ({ username }) => {
      console.log(`Telegram bot @${username} polling`);
    },
  });

  return bot;
}

function parseFplId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  const fromUrl = trimmed.match(/entry\/(\d+)/i);
  if (fromUrl) return Number(fromUrl[1]);
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : null;
}