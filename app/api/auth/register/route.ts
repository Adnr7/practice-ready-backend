import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  createSessionCookie,
  createSessionToken,
  hashPassword,
} from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      fullName?: string;
      studentId?: string;
      role?: "student" | "technician" | "admin";
    };

    const email = body.email?.trim().toLowerCase();
    const password = body.password?.trim();
    const fullName = body.fullName?.trim();
    const studentId = body.studentId?.trim();
    const role = body.role === "technician" || body.role === "admin" ? body.role : "student";

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

    const db = getDb();
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

    const token = await createSessionToken({
      userId: inserted.id,
      email: inserted.email,
      fullName: inserted.fullName,
      studentId: inserted.studentId ?? undefined,
      role: inserted.role as any,
    });

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
        "Set-Cookie": createSessionCookie(token),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
