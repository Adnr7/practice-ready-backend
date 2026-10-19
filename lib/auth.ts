/**
 * Edge-Native WebCrypto Authentication & Session Management
 * Fully compatible with Cloudflare Workers runtime and Node 22+.
 */

import {
  getStoredSession,
  isStoredSessionToken,
  revokeStoredSession,
  SESSION_MAX_AGE_SECONDS,
} from "./session-store.ts";

export interface SessionPayload {
  userId: number;
  email: string;
  studentId?: string;
  fullName: string;
  role: "student" | "technician" | "admin";
  exp: number; // Unix epoch in seconds
}

export class AuthRequestError extends Error {
  readonly code: string;

  constructor(message: string, code = "BODY_INVALID") {
    super(message);
    this.name = "AuthRequestError";
    this.code = code;
  }
}

export async function readAuthJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AuthRequestError("Request body must be valid JSON.", "INVALID_JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AuthRequestError("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthRequestError) {
    return Response.json({ error: error.message, code: error.code }, { status: 400 });
  }
  return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
}

let configuredAuthSecret: string | undefined;

export function configureAuthSecret(secret?: string): void {
  if (secret) configuredAuthSecret = secret;
}

function getSecretKey(): string {
  if (typeof process !== "undefined" && process.env?.AUTH_SECRET) {
    return process.env.AUTH_SECRET;
  }
  if (typeof process !== "undefined" && process.env?.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  if (configuredAuthSecret) return configuredAuthSecret;
  throw new Error("AUTH_SECRET must be configured before using authentication.");
}

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Hashes a password using standard PBKDF2 (SHA-256) with 100,000 iterations.
 */
export async function hashPassword(
  password: string,
  providedSalt?: string
): Promise<{ hash: string; salt: string }> {
  const encoder = new TextEncoder();
  const saltBytes = providedSalt
    ? hexToBytes(providedSalt)
    : crypto.getRandomValues(new Uint8Array(16));
  const salt = providedSalt ?? bytesToHex(saltBytes);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes as unknown as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  const hash = bytesToHex(new Uint8Array(derivedBits));
  return { hash, salt };
}

/**
 * Verifies a plaintext password against a stored PBKDF2 hash and salt.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  const { hash } = await hashPassword(password, storedSalt);
  if (hash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Legacy HMAC utility. Signed tokens alone no longer authenticate requests.
 */
export async function createSessionToken(
  payload: Omit<SessionPayload, "exp"> & { exp?: number },
  expiresInSeconds = 86400
): Promise<string> {
  const exp = payload.exp ?? Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload: SessionPayload = { ...payload, exp };

  const encoder = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));
  const dataToSign = `${headerB64}.${payloadB64}`;

  const hmacKey = await getHmacKey(getSecretKey());
  const signature = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encoder.encode(dataToSign)
  );

  const signatureB64 = base64UrlEncode(signature);
  return `${dataToSign}.${signatureB64}`;
}

/**
 * Verifies legacy HMAC claims only; this does not establish a DB-backed session.
 */
export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const encoder = new TextEncoder();
    const dataToSign = `${headerB64}.${payloadB64}`;
    const signature = base64UrlDecode(signatureB64);

    const hmacKey = await getHmacKey(getSecretKey());
    const isValid = await crypto.subtle.verify(
      "HMAC",
      hmacKey,
      signature as unknown as BufferSource,
      encoder.encode(dataToSign)
    );

    if (!isValid) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as SessionPayload;

    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload.exp) || payload.exp <= now ||
        !Number.isSafeInteger(payload.userId) || payload.userId <= 0 ||
        !["student", "technician", "admin"].includes(payload.role)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Parses cookies from standard Cookie header.
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name) {
      try {
        cookies[name] = decodeURIComponent(rest.join("="));
      } catch {
        // Ignore malformed cookies rather than failing the entire request.
      }
    }
  }
  return cookies;
}

export function createSessionCookie(token: string, secure = false): string {
  return `pr_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function createClearSessionCookie(secure = false): string {
  return `pr_session=; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=0`;
}

async function getSessionDatabase(customDb?: D1Database): Promise<D1Database> {
  if (customDb) return customDb;
  // Keep the Worker-only module out of pure Node crypto/cookie tests.
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return env.DB;
}

export async function getSessionFromRequest(request: Request, customDb?: D1Database): Promise<SessionPayload | null> {
  const token = parseCookies(request.headers.get("cookie"))["pr_session"];
  if (!token || !isStoredSessionToken(token)) return null;
  try {
    return await getStoredSession(await getSessionDatabase(customDb), token);
  } catch {
    // Missing bindings, migrations, or unavailable storage must never grant access.
    return null;
  }
}

export async function revokeSessionFromRequest(request: Request, customDb?: D1Database): Promise<void> {
  const token = parseCookies(request.headers.get("cookie"))["pr_session"];
  if (!token || !isStoredSessionToken(token)) return;
  // Unlike reads, revocation failures must propagate so logout cannot claim success.
  await revokeStoredSession(await getSessionDatabase(customDb), token);
}
