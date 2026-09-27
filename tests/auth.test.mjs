import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  createSessionCookie,
  createClearSessionCookie,
} from "../lib/auth.ts";

describe("Edge Auth & Cryptography", () => {
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

    const cleared = createClearSessionCookie();
    assert.ok(cleared.includes("Max-Age=0"));
  });
});
