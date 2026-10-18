import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  authErrorResponse,
  createSessionCookie,
  readAuthJson,
  verifyPassword,
} from "@/lib/auth";
import { createStoredSession } from "@/lib/session-store";

export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return Response.json(
        { error: "email and password are required." },
        { status: 400 }
      );
    }

    const dbBinding = env.DB;
    if (!dbBinding) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
    const db = getDb(dbBinding);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || !user.isActive) {
      return Response.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, user.passwordHash, user.salt);
    if (!isValid) {
      return Response.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const token = await createStoredSession(dbBinding, user.id);

    const userProfile = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      studentId: user.studentId,
      role: user.role,
      createdAt: user.createdAt,
    };

    return new Response(JSON.stringify({ user: userProfile }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": createSessionCookie(token, new URL(request.url).protocol === "https:"),
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
