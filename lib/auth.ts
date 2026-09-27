/**
 * Edge-Native WebCrypto Authentication & Session Management
 * Fully compatible with Cloudflare Workers runtime and Node 22+.
 */

export interface SessionPayload {
  userId: number;
  email: string;
  studentId?: string;
  fullName: string;
  role: "student" | "technician" | "admin";
  exp: number; // Unix epoch in seconds
}

const DEFAULT_SECRET = "practice-ready-tsm-university-edge-secret-2026";

function getSecretKey(): string {
  if (typeof process !== "undefined" && process.env?.AUTH_SECRET) {
    return process.env.AUTH_SECRET;
  }
  if (typeof process !== "undefined" && process.env?.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  return DEFAULT_SECRET;
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
      salt: saltBytes,
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
 * Generates an HMAC-SHA256 signed session token.
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
 * Verifies an HMAC-SHA256 session token and checks its expiration.
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
      signature,
      encoder.encode(dataToSign)
    );

    if (!isValid) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as SessionPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
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
      cookies[name] = decodeURIComponent(rest.join("="));
    }
  }
  return cookies;
}

export function createSessionCookie(token: string): string {
  return `pr_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}

export function createClearSessionCookie(): string {
  return `pr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function getSessionFromRequest(request: Request): Promise<SessionPayload | null> {
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const token = cookies["pr_session"];
  if (!token) return null;
  return verifySessionToken(token);
}
