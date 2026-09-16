/**
 * Pre-seeded username → FPL team claims.
 *
 * Configured via CANCHEROS_USERNAME_CLAIMS env var:
 *   CANCHEROS_USERNAME_CLAIMS=@user1:123456,@user2:234567,@user3:345678
 *
 * Leading "@" on usernames is optional in the env and in lookups.
 */

function parseClaims() {
  const raw = process.env.CANCHEROS_USERNAME_CLAIMS || "";
  if (!raw.trim()) return { byUsername: new Map(), byFplId: new Map() };

  const byUsername = new Map();
  const byFplId = new Map();

  for (const piece of raw.split(",")) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;

    const userPart = trimmed.slice(0, colon).trim();
    const fplPart = trimmed.slice(colon + 1).trim();
    if (!userPart || !fplPart) continue;

    const username = userPart.startsWith("@")
      ? userPart.slice(1).toLowerCase()
      : userPart.toLowerCase();
    const fplId = Number(fplPart);
    if (!username || !Number.isInteger(fplId) || fplId <= 0) continue;

    byUsername.set(username, fplId);
    byFplId.set(fplId, username);
  }

  return { byUsername, byFplId };
}

const CACHE = parseClaims();

export function hasConfiguredClaims() {
  return CACHE.byUsername.size > 0;
}

/**
 * Look up the FPL ID claimed by a Telegram username.
 * Returns the FPL ID number, or null if not claimed.
 */
export function findClaimFplIdByUsername(username) {
  if (!username) return null;
  const normalized = String(username)
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!normalized) return null;
  const fplId = CACHE.byUsername.get(normalized);
  return fplId == null ? null : fplId;
}

/**
 * Reverse lookup: given an FPL team ID, return the Telegram @username
 * that claimed it, or null if unclaimed.
 */
export function findClaimUsernameByFplId(fplId) {
  const id = Number(fplId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const user = CACHE.byFplId.get(id);
  return user != null ? `@${user}` : null;
}

/**
 * Returns the full in-memory claim snapshot for debugging / admin endpoints.
 */
export function listUsernameClaims() {
  return Array.from(CACHE.byUsername.entries()).map(([username, fplId]) => ({
    username: `@${username}`,
    fplId,
  }));
}
