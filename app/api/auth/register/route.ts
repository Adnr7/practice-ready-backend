import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  authErrorResponse,
  createSessionCookie,
  hashPassword,
  readAuthJson,
} from "@/lib/auth";
import { createStoredSession } from "@/lib/session-store";

export async function POST(request: Request) {
  try {
    const body = await readAuthJson(request);

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    if (body.studentId != null && typeof body.studentId !== "string") {
      return Response.json({ error: "studentId must be a string." }, { status: 400 });
    }
    const studentId = typeof body.studentId === "string" ? body.studentId.trim() : undefined;
    // Public registration can only create student accounts. Staff roles must
    // be provisioned by an administrator or the seed process.
    const role = "student" as const;

    if (!email || !password || !fullName) {
      return Response.json(
        { error: "email, password, and fullName are required." },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json(
        { error: "Invalid email address format." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return Response.json(
        { error: "Password must be at least 8 characters long." },
        { status: 400 }
      );
    }

    const dbBinding = env.DB;
    if (!dbBinding) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
    const db = getDb(dbBinding);
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      return Response.json(
        { error: "An account with this email already exists." },
        { status: 400 }
      );
    }

    const { hash, salt } = await hashPassword(password);
    const [inserted] = await db
      .insert(users)
      .values({
        email,
        passwordHash: hash,
        salt,
        fullName,
        studentId: studentId ?? null,
        role,
      })
      .returning();

    const token = await createStoredSession(dbBinding, inserted.id);

    const userProfile = {
      id: inserted.id,
      email: inserted.email,
      fullName: inserted.fullName,
      studentId: inserted.studentId,
      role: inserted.role,
      createdAt: inserted.createdAt,
    };

    return new Response(JSON.stringify({ user: userProfile }), {
      status: 201,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": createSessionCookie(token, new URL(request.url).protocol === "https:"),
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
