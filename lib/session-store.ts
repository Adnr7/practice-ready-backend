import type { SessionPayload } from "./auth.ts";

export const SESSION_MAX_AGE_SECONDS = 86400;

// A separate opaque-token format prevents legacy signed claims from authenticating.
export function isStoredSessionToken(token: string): boolean {
  return /^pr_s1_[0-9a-f]{64}$/.test(token);
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Only the one-way hash is persisted; the bearer token is returned to the caller once. */
export async function createStoredSession(
  db: D1Database,
  userId: number,
  expiresInSeconds = SESSION_MAX_AGE_SECONDS
): Promise<string> {
  if (!Number.isSafeInteger(userId) || userId <= 0 ||
      !Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error("A session requires a valid user ID and positive lifetime.");
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + expiresInSeconds;
  if (!Number.isSafeInteger(expiresAt)) throw new Error("Invalid session expiry.");
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = `pr_s1_${Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const tokenHash = await hashToken(token);
  // Recheck account state in the insert, including a deactivation during login.
  const result = await db.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
    SELECT ?, id, ?, ? FROM users
    WHERE id = ? AND is_active = 1 AND role IN ('student', 'technician', 'admin')
  `).bind(tokenHash, now, expiresAt, userId).run();
  if (result.meta.changes !== 1) throw new Error("Cannot create a session for an inactive or missing account.");
  return token;
}

/** Resolve identity and authorization from the current account, never cookie claims. */
export async function getStoredSession(db: D1Database, token: string): Promise<SessionPayload | null> {
  if (!isStoredSessionToken(token)) return null;
  const row = await db.prepare(`
    SELECT u.id AS userId, u.email, u.full_name AS fullName, u.student_id AS studentId,
      u.role, s.expires_at AS exp
    FROM sessions s INNER JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.is_active = 1
    LIMIT 1
  `).bind(await hashToken(token), Math.floor(Date.now() / 1000)).first<Omit<SessionPayload, "studentId"> & { studentId: string | null }>();
  if (!row || !Number.isSafeInteger(row.userId) || row.userId <= 0 ||
      !Number.isSafeInteger(row.exp) || !["student", "technician", "admin"].includes(row.role)) return null;
  return {
    userId: row.userId,
    email: row.email,
    fullName: row.fullName,
    studentId: row.studentId ?? undefined,
    role: row.role,
    exp: row.exp,
  };
}

/** Idempotently revoke just this bearer token, even if its account is now inactive. */
export async function revokeStoredSession(db: D1Database, token: string): Promise<void> {
  if (!isStoredSessionToken(token)) return;
  await db.prepare(`
    UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL
  `).bind(Math.floor(Date.now() / 1000), await hashToken(token)).run();
}
