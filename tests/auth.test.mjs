import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  createSessionCookie,
  createClearSessionCookie,
  getSessionFromRequest,
  revokeSessionFromRequest,
} from "../lib/auth.ts";

describe("Edge Auth & Cryptography", () => {
  const originalSecret = process.env.AUTH_SECRET;
  before(() => { process.env.AUTH_SECRET = "test-only-session-secret-never-deploy"; });
  after(() => {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalSecret;
  });
  it("should hash and verify passwords using PBKDF2", async () => {
    const password = "PracticeMusic2026!";
    const { hash, salt } = await hashPassword(password);

    assert.ok(hash.length > 20, "Hash should be non-empty");
    assert.ok(salt.length > 10, "Salt should be non-empty");

    const isValid = await verifyPassword(password, hash, salt);
    assert.equal(isValid, true, "Correct password must verify successfully");

    const isInvalid = await verifyPassword("WrongPassword123", hash, salt);
    assert.equal(isInvalid, false, "Incorrect password must fail verification");
  });

  it("preserves leading and trailing password whitespace", async () => {
    const password = "  PracticeMusic2026!  ";
    const { hash, salt } = await hashPassword(password);
    assert.equal(await verifyPassword(password, hash, salt), true);
    assert.equal(await verifyPassword(password.trim(), hash, salt), false);
  });

  it("should sign and verify HMAC-SHA256 session tokens", async () => {
    const payload = {
      userId: 101,
      email: "elizabeth.john@tsm.edu.in",
      fullName: "Elizabeth John",
      role: "student",
      studentId: "TSM-2026-0042",
    };

    const token = await createSessionToken(payload);
    assert.ok(typeof token === "string" && token.split(".").length === 3);

    const verified = await verifySessionToken(token);
    assert.ok(verified !== null);
    assert.equal(verified.userId, 101);
    assert.equal(verified.email, "elizabeth.john@tsm.edu.in");
    assert.equal(verified.role, "student");
    assert.equal(verified.studentId, "TSM-2026-0042");
  });

  it("should reject expired or tampered session tokens", async () => {
    const expiredPayload = {
      userId: 102,
      email: "expired@tsm.edu.in",
      fullName: "Expired User",
      role: "student",
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour in the past
    };

    const expiredToken = await createSessionToken(expiredPayload);
    const result = await verifySessionToken(expiredToken);
    assert.equal(result, null, "Expired token must be rejected");

    // Tampered token
    const parts = expiredToken.split(".");
    const tampered = `${parts[0]}.${parts[1]}.tamperedSignature`;
    const tamperedResult = await verifySessionToken(tampered);
    assert.equal(tamperedResult, null, "Tampered token must be rejected");
  });

  it("should format and parse session cookies properly", () => {
    const cookie = createSessionCookie("sample.jwt.token");
    assert.ok(cookie.includes("pr_session=sample.jwt.token"));
    assert.ok(cookie.includes("HttpOnly"));
    assert.ok(cookie.includes("SameSite=Lax"));

    const parsed = parseCookies("pr_session=sample.jwt.token; other=123");
    assert.equal(parsed["pr_session"], "sample.jwt.token");
    assert.equal(parsed["other"], "123");
    assert.deepEqual(parseCookies("bad=%ZZ; other=123"), { other: "123" });

    const cleared = createClearSessionCookie();
    assert.ok(cleared.includes("Max-Age=0"));
  });

  it("rejects zero-expiry tokens and tolerates malformed cookies", async () => {
    const payload = { userId: 1, email: "test@example.com", fullName: "Test", role: "student", exp: 0 };
    assert.equal(await verifySessionToken(await createSessionToken(payload)), null);
    assert.deepEqual(parseCookies("bad=%ZZ; other=123"), { other: "123" });
  });

  it("requires a configured secret when signing sessions", async () => {
    const jwtSecret = process.env.JWT_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.JWT_SECRET;
    try {
      await assert.rejects(createSessionToken({ userId: 1, email: "test@example.com", fullName: "Test", role: "student" }), /AUTH_SECRET/);
    } finally {
      process.env.AUTH_SECRET = "test-only-session-secret-never-deploy";
      if (jwtSecret !== undefined) process.env.JWT_SECRET = jwtSecret;
    }
  });

  it("rejects legacy signed cookies even when their signatures and claims verify", async () => {
    const token = await createSessionToken({ userId: 1, email: "admin@example.com", fullName: "Admin", role: "admin" });
    assert.ok(await verifySessionToken(token));
    const request = new Request("https://example.com/protected", { headers: { cookie: `pr_session=${token}` } });
    let queried = false;
    const unavailableDb = { prepare() { queried = true; throw new Error("Legacy tokens must not reach storage"); } };
    assert.equal(await getSessionFromRequest(request, unavailableDb), null);
    assert.equal(queried, false);
  });

  it("fails closed without a Worker runtime or when session storage fails", async () => {
    const token = `pr_s1_${"a".repeat(64)}`;
    const request = new Request("https://example.com/protected", { headers: { cookie: `pr_session=${token}` } });
    assert.equal(await getSessionFromRequest(request), null);
    const unavailableDb = { prepare() { throw new Error("Storage unavailable"); } };
    assert.equal(await getSessionFromRequest(request, unavailableDb), null);
    await assert.rejects(revokeSessionFromRequest(request, unavailableDb), /Storage unavailable/);
  });

  it("treats missing, malformed, and unknown-format session cookies as anonymous", async () => {
    for (const cookie of ["", "pr_session=%ZZ", "pr_session=garbage", `pr_session=pr_s1_${"a".repeat(63)}`]) {
      const request = new Request("https://example.com/protected", { headers: { cookie } });
      assert.equal(await getSessionFromRequest(request), null);
      await revokeSessionFromRequest(request);
    }
  });
});
