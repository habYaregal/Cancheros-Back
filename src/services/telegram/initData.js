import crypto from "node:crypto";

const MAX_AGE_SECONDS = 24 * 60 * 60;

export function parseTelegramInitData(initData, botToken) {
  if (!initData || !botToken) {
    const error = new Error("Telegram login is required. Open Cancheros from the bot.");
    error.status = 401;
    throw error;
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    const error = new Error("Invalid Telegram session.");
    error.status = 401;
    throw error;
  }

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const computedBuf = Buffer.from(computed, "hex");
  const hashBuf = Buffer.from(hash, "hex");

  if (
    computedBuf.length !== hashBuf.length ||
    !crypto.timingSafeEqual(computedBuf, hashBuf)
  ) {
    const error = new Error("Invalid Telegram session.");
    error.status = 401;
    throw error;
  }

  const authDate = Number(params.get("auth_date") || 0);
  const age = Math.floor(Date.now() / 1000) - authDate;

  if (!authDate || age > MAX_AGE_SECONDS) {
    const error = new Error("Telegram session expired. Close and reopen the Mini App.");
    error.status = 401;
    throw error;
  }

  let user = null;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch {
    user = null;
  }

  if (!user?.id) {
    const error = new Error("Telegram user is missing from this session.");
    error.status = 401;
    throw error;
  }

  return {
    user,
    authDate,
    startParam: params.get("start_param") || null,
  };
}
