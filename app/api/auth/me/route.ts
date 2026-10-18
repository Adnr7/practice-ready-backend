import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { AuthRequestError, authErrorResponse, configureAuthSecret, getSessionFromRequest, readAuthJson } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) {
      return Response.json({ user: null });
    }

    const db = getDb();
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        studentId: users.studentId,
        phone: users.phone,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user || !user.isActive) return Response.json({ user: null });
    return Response.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await readAuthJson(request);
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    if (body.phone !== undefined && body.phone !== null && typeof body.phone !== "string") throw new AuthRequestError("phone must be a string or null.", "PROFILE_PHONE_INVALID");
    const phone = body.phone === null ? null : typeof body.phone === "string" ? body.phone.trim() : undefined;
    if (fullName.length < 2 || fullName.length > 120) throw new AuthRequestError("fullName must be between 2 and 120 characters.", "PROFILE_NAME_INVALID");
    if (phone !== undefined && phone !== null && phone.length > 40) throw new AuthRequestError("phone must be 40 characters or fewer.", "PROFILE_PHONE_INVALID");
    const [updated] = await getDb().update(users).set({ fullName, ...(phone === undefined ? {} : { phone }) }).where(eq(users.id, session.userId)).returning({ id: users.id, email: users.email, fullName: users.fullName, studentId: users.studentId, phone: users.phone, role: users.role, createdAt: users.createdAt });
    if (!updated) return Response.json({ error: "Account not found." }, { status: 404 });
    return Response.json({ user: updated });
  } catch (error) {
    return authErrorResponse(error);
  }
}
