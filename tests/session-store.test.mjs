import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createSessionToken, getSessionFromRequest, hashPassword, verifyPassword } from "../lib/auth.ts";
import {
  createStoredSession,
  getStoredSession,
  revokeStoredSession,
  SESSION_MAX_AGE_SECONDS,
} from "../lib/session-store.ts";

// Both tools are bundled with the project's pinned Wrangler, with no global installs.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const root = fileURLToPath(new URL("../", import.meta.url));
const migrations = [
  "0000_lush_misty_knight.sql", "0001_new_the_hood.sql", "0002_open_layla_miller.sql",
  "0003_amusing_nekra.sql", "0004_equipment_movements.sql", "0005_reservation_lifecycle.sql",
  "0006_room_readiness.sql", "0007_frontend_workflows.sql", "0008_sessions.sql",
];

// Exercise the real route handlers and the lazy Cloudflare binding lookup in a Worker.
const worker = `
  import * as login from "./app/api/auth/login/route.ts";
  import * as register from "./app/api/auth/register/route.ts";
  import * as logout from "./app/api/auth/logout/route.ts";
  import * as me from "./app/api/auth/me/route.ts";
  import { getSessionFromRequest } from "./lib/auth.ts";
  const routes = {
    "/api/auth/login": { POST: login.POST },
    "/api/auth/register": { POST: register.POST },
    "/api/auth/logout": { POST: logout.POST },
    "/api/auth/me": { GET: me.GET, PATCH: me.PATCH },
  };
  export default {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/protected" || path === "/staff") {
        const session = await getSessionFromRequest(request);
        if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
        if (path === "/staff" && session.role === "student") return new Response(null, { status: 403 });
        return Response.json({ session });
      }
      const handler = routes[path]?.[request.method];
      return handler ? handler(request) : new Response(null, { status: 404 });
    },
  };
`;

let emulator;
let db;
let credentials;
const password = "  PracticeMusic2026!  ";
const originalSecret = process.env.AUTH_SECRET;

function dispatch(path, { method = "GET", cookie, body, raw } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined || raw !== undefined) headers["content-type"] = "application/json";
  return emulator.dispatchFetch(`https://example.com${path}`, {
    method,
    headers,
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function sessionCookie(response) {
  const header = response.headers.get("set-cookie");
  assert.ok(header, "A successful login/registration must set a cookie");
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /; Secure/);
  assert.match(header, /Max-Age=86400/);
  return header.split(";")[0];
}

async function login() {
  const response = await dispatch("/api/auth/login", { method: "POST", body: { email: " STUDENT@EXAMPLE.COM ", password } });
  assert.equal(response.status, 200, await response.clone().text());
  return sessionCookie(response);
}

before(async () => {
  process.env.AUTH_SECRET = "test-only-legacy-session-secret";
  credentials = await hashPassword(password);
  const bundled = await build({
    stdin: { contents: worker, resolveDir: root, sourcefile: "session-store-worker.ts", loader: "ts" },
    absWorkingDir: root,
    tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["cloudflare:workers"],
    logLevel: "silent",
  });
  emulator = new Miniflare({
    modules: true,
    script: bundled.outputFiles[0].text,
    compatibilityDate: "2026-05-15",
    d1Databases: ["DB"],
  });
  db = await emulator.getD1Database("DB");
  for (const file of migrations) {
    const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").filter((part) => part.trim())) {
      await db.prepare(statement).run();
    }
  }
});

after(async () => {
  await emulator?.dispose();
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

beforeEach(async () => {
  await db.batch([
    db.prepare("DROP TRIGGER IF EXISTS fail_session_revoke"),
    db.prepare("DROP TRIGGER IF EXISTS fail_session_create"),
    db.prepare("DELETE FROM sessions"),
    db.prepare("DELETE FROM users"),
    db.prepare(`INSERT INTO users (id, email, password_hash, salt, full_name, student_id, role)
      VALUES (1, 'student@example.com', ?, ?, 'Student One', 'TSM-001', 'student')`).bind(credentials.hash, credentials.salt),
    db.prepare(`INSERT INTO users (id, email, password_hash, salt, full_name, role)
      VALUES (2, 'admin@example.com', ?, ?, 'Administrator', 'admin')`).bind(credentials.hash, credentials.salt),
  ]);
});

describe("D1 revocable session storage", () => {
  it("persists only a SHA-256 hash of a unique random token and reads it back", async () => {
    const token = await createStoredSession(db, 1);
    assert.match(token, /^pr_s1_[0-9a-f]{64}$/);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const expectedHash = Buffer.from(digest).toString("hex");
    const row = await db.prepare("SELECT * FROM sessions").first();
    assert.equal(row.token_hash, expectedHash);
    assert.equal(row.user_id, 1);
    assert.equal(row.expires_at - row.created_at, SESSION_MAX_AGE_SECONDS);
    assert.equal(row.revoked_at, null);
    assert.equal(JSON.stringify(row).includes(token), false);
    assert.deepEqual(Object.keys(row).sort(), ["created_at", "expires_at", "revoked_at", "token_hash", "user_id"]);
    const session = await getStoredSession(db, token);
    assert.deepEqual(session, {
      userId: 1, email: "student@example.com", fullName: "Student One", studentId: "TSM-001", role: "student", exp: row.expires_at,
    });
    const request = new Request("https://example.com/protected", { headers: { cookie: `pr_session=${token}` } });
    assert.deepEqual(await getSessionFromRequest(request, db), session);
    assert.notEqual(await createStoredSession(db, 1), token);
  });

  it("rejects unknown, malformed, tampered, and legacy signed tokens", async () => {
    const token = await createStoredSession(db, 1);
    const legacy = await createSessionToken({ userId: 2, email: "admin@example.com", fullName: "Admin", role: "admin" });
    const tampered = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    for (const invalid of ["", "not-a-session", `pr_s1_${"a".repeat(64)}`, tampered, legacy]) {
      assert.equal(await getStoredSession(db, invalid), null);
    }
  });

  it("expires at the exact stored expiry boundary", async () => {
    const token = await createStoredSession(db, 1);
    await db.prepare("UPDATE sessions SET expires_at = ?").bind(Math.floor(Date.now() / 1000)).run();
    assert.equal(await getStoredSession(db, token), null);
  });

  it("revokes only the current session and repeated revocation is harmless", async () => {
    const first = await createStoredSession(db, 1);
    const second = await createStoredSession(db, 1);
    await revokeStoredSession(db, first);
    const revokedAt = await db.prepare("SELECT revoked_at FROM sessions WHERE revoked_at IS NOT NULL").first("revoked_at");
    assert.equal(typeof revokedAt, "number");
    await revokeStoredSession(db, first);
    assert.equal(await getStoredSession(db, first), null);
    assert.ok(await getStoredSession(db, second));
    assert.equal(await db.prepare("SELECT revoked_at FROM sessions WHERE revoked_at IS NOT NULL").first("revoked_at"), revokedAt);
  });

  it("loads current identity and role rather than stale login-time claims", async () => {
    const token = await createStoredSession(db, 2);
    await db.prepare("UPDATE users SET email = 'new@example.com', full_name = 'Current Name', student_id = 'NEW-ID', role = 'student' WHERE id = 2").run();
    const session = await getStoredSession(db, token);
    assert.equal(session.email, "new@example.com");
    assert.equal(session.fullName, "Current Name");
    assert.equal(session.studentId, "NEW-ID");
    assert.equal(session.role, "student");
  });

  it("rejects inactive, deleted, or unrecognized-role accounts", async () => {
    const token = await createStoredSession(db, 1);
    await db.prepare("UPDATE users SET is_active = 0 WHERE id = 1").run();
    assert.equal(await getStoredSession(db, token), null);
    await assert.rejects(createStoredSession(db, 1), /inactive or missing/);
    await db.prepare("UPDATE users SET is_active = 1, role = 'superuser' WHERE id = 1").run();
    assert.equal(await getStoredSession(db, token), null);
    await assert.rejects(createStoredSession(db, 1), /inactive or missing/);
    await db.prepare("DELETE FROM users WHERE id = 1").run();
    assert.equal(await getStoredSession(db, token), null);
    assert.equal(await db.prepare("SELECT count(*) FROM sessions").first("count(*)"), 0);
    await assert.rejects(createStoredSession(db, 1), /inactive or missing/);
  });

  it("does not create sessions for invalid user IDs or invalid lifetimes", async () => {
    for (const userId of [0, -1, 1.5, NaN]) await assert.rejects(createStoredSession(db, userId));
    for (const lifetime of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER]) await assert.rejects(createStoredSession(db, 1, lifetime));
    assert.equal(await db.prepare("SELECT count(*) FROM sessions").first("count(*)"), 0);
  });
});

describe("Worker auth routes with persisted sessions", () => {
  it("registers only students, preserves passwords, and creates immediately usable DB sessions", async () => {
    for (const role of ["admin", "technician"]) {
      const response = await dispatch("/api/auth/register", {
        method: "POST", body: { email: ` ${role}@new.example.com `, fullName: " New Student ", studentId: " NEW-1 ", password, role },
      });
      assert.equal(response.status, 201, await response.clone().text());
      const { user } = await response.json();
      assert.equal(user.role, "student");
      assert.equal(user.fullName, "New Student");
      assert.equal(user.studentId, "NEW-1");
      const cookie = sessionCookie(response);
      const authenticated = await dispatch("/protected", { cookie });
      assert.equal(authenticated.status, 200);
      assert.equal((await authenticated.json()).session.userId, user.id);
      const stored = await db.prepare("SELECT password_hash, salt FROM users WHERE id = ?").bind(user.id).first();
      assert.equal(await verifyPassword(password, stored.password_hash, stored.salt), true);
      assert.equal(await verifyPassword(password.trim(), stored.password_hash, stored.salt), false);
    }
    assert.equal(await db.prepare("SELECT count(*) FROM sessions").first("count(*)"), 2);
  });

  it("logs in with the exact password and revalidates profile changes on the same cookie", async () => {
    const cookie = await login();
    assert.equal((await dispatch("/api/auth/me", { cookie })).status, 200);
    const update = await dispatch("/api/auth/me", { method: "PATCH", cookie, body: { fullName: "Updated Student", phone: "12345" } });
    assert.equal(update.status, 200, await update.clone().text());
    const protectedResponse = await dispatch("/protected", { cookie });
    assert.equal((await protectedResponse.json()).session.fullName, "Updated Student");
    const invalid = await dispatch("/api/auth/login", { method: "POST", body: { email: "student@example.com", password: password.trim() } });
    assert.equal(invalid.status, 401);
    assert.equal(invalid.headers.get("set-cookie"), null);
    assert.equal(await db.prepare("SELECT count(*) FROM sessions").first("count(*)"), 1);
  });

  it("rechecks current staff role and active-account status on every protected request", async () => {
    const token = await createStoredSession(db, 2);
    const cookie = `pr_session=${token}`;
    assert.equal((await dispatch("/staff", { cookie })).status, 200);
    await db.prepare("UPDATE users SET role = 'student' WHERE id = 2").run();
    assert.equal((await dispatch("/staff", { cookie })).status, 403);
    await db.prepare("UPDATE users SET role = 'technician' WHERE id = 2").run();
    assert.equal((await dispatch("/staff", { cookie })).status, 200);
    await db.prepare("UPDATE users SET is_active = 0 WHERE id = 2").run();
    assert.equal((await dispatch("/protected", { cookie })).status, 401);
    assert.deepEqual(await (await dispatch("/api/auth/me", { cookie })).json(), { user: null });
    assert.equal((await dispatch("/api/auth/me", { method: "PATCH", cookie, body: { fullName: "Disallowed Update" } })).status, 401);
    assert.equal((await dispatch("/api/auth/login", { method: "POST", body: { email: "admin@example.com", password } })).status, 401);
  });

  it("logs out by revoking the cookie server-side so replay fails but another session survives", async () => {
    const first = await login();
    const second = await login();
    const logout = await dispatch("/api/auth/logout", { method: "POST", cookie: first });
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { success: true });
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal((await dispatch("/protected", { cookie: first })).status, 401);
    assert.deepEqual(await (await dispatch("/api/auth/me", { cookie: first })).json(), { user: null });
    assert.equal((await dispatch("/protected", { cookie: second })).status, 200);
    assert.equal((await dispatch("/api/auth/logout", { method: "POST", cookie: first })).status, 200);
    assert.equal((await dispatch("/api/auth/logout", { method: "POST" })).status, 200);
  });

  it("can revoke a session after its account has been deactivated", async () => {
    const cookie = await login();
    await db.prepare("UPDATE users SET is_active = 0 WHERE id = 1").run();
    assert.equal((await dispatch("/api/auth/logout", { method: "POST", cookie })).status, 200);
    await db.prepare("UPDATE users SET is_active = 1 WHERE id = 1").run();
    assert.equal((await dispatch("/protected", { cookie })).status, 401);
  });

  it("fails closed for expired, deleted-user, malformed, unknown, and signed legacy cookies", async () => {
    const token = await createStoredSession(db, 1);
    await db.prepare("UPDATE sessions SET expires_at = ?").bind(Math.floor(Date.now() / 1000)).run();
    const legacy = await createSessionToken({ userId: 2, email: "admin@example.com", fullName: "Admin", role: "admin" });
    const cookies = [`pr_session=${token}`, "pr_session=%ZZ", `pr_session=pr_s1_${"a".repeat(64)}`, `pr_session=${legacy}`];
    const deleted = await createStoredSession(db, 2);
    await db.prepare("DELETE FROM users WHERE id = 2").run();
    cookies.push(`pr_session=${deleted}`);
    for (const cookie of cookies) assert.equal((await dispatch("/protected", { cookie })).status, 401);
  });

  it("returns 400 for invalid JSON, non-object bodies, and incorrectly typed auth fields", async () => {
    const malformed = ["{", "", "null", "[]", '"text"', "42", "true"];
    for (const raw of malformed) {
      for (const path of ["/api/auth/login", "/api/auth/register"]) {
        const response = await dispatch(path, { method: "POST", raw });
        assert.equal(response.status, 400, `${path}: ${raw}: ${await response.text()}`);
        assert.equal(response.headers.get("set-cookie"), null);
      }
    }
    const valid = { email: "new@example.com", password, fullName: "New Student" };
    for (const body of [{ ...valid, email: 123 }, { ...valid, password: [] }, { ...valid, password: {} }]) {
      for (const path of ["/api/auth/login", "/api/auth/register"]) {
        assert.equal((await dispatch(path, { method: "POST", body })).status, 400);
      }
    }
    for (const body of [{ ...valid, fullName: [] }, { ...valid, studentId: {} }]) {
      assert.equal((await dispatch("/api/auth/register", { method: "POST", body })).status, 400);
    }
    assert.equal(await db.prepare("SELECT count(*) FROM sessions").first("count(*)"), 0);
    assert.equal(await db.prepare("SELECT count(*) FROM users").first("count(*)"), 2);
    const cookie = await login();
    for (const raw of malformed) assert.equal((await dispatch("/api/auth/me", { method: "PATCH", cookie, raw })).status, 400);
    for (const body of [{ fullName: [] }, { fullName: "Student", phone: 123 }]) {
      assert.equal((await dispatch("/api/auth/me", { method: "PATCH", cookie, body })).status, 400);
    }
  });

  it("does not issue a cookie when session persistence fails", async () => {
    await db.prepare("CREATE TRIGGER fail_session_create BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'session storage unavailable'); END").run();
    for (const [path, body] of [
      ["/api/auth/login", { email: "student@example.com", password }],
      ["/api/auth/register", { email: "new@example.com", password, fullName: "New Student" }],
    ]) {
      const response = await dispatch(path, { method: "POST", body });
      assert.equal(response.status, 500);
      assert.equal(response.headers.get("set-cookie"), null);
    }
    assert.equal(await db.prepare("SELECT count(*) FROM sessions").first("count(*)"), 0);
  });

  it("reports logout storage failure instead of falsely claiming revocation", async () => {
    const cookie = await login();
    await db.prepare("CREATE TRIGGER fail_session_revoke BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'session storage unavailable'); END").run();
    const response = await dispatch("/api/auth/logout", { method: "POST", cookie });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await dispatch("/protected", { cookie })).status, 200);
    await db.prepare("DROP TRIGGER fail_session_revoke").run();
    assert.equal((await dispatch("/api/auth/logout", { method: "POST", cookie })).status, 200);
    assert.equal((await dispatch("/protected", { cookie })).status, 401);
  });
});
