import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { FrontendWorkflowError, readJson, requireStaff, workflowErrorResponse } from "@/lib/frontend-workflows";

export async function POST(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireStaff({ userId: session.userId, role: session.role });
    const body = await readJson(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const team = typeof body.team === "string" ? body.team.trim() : "FTS";
    const hours = typeof body.hours === "string" ? body.hours.trim() : "";
    if (!name || !hours) throw new FrontendWorkflowError("name and hours are required.", 400, "CONTACT_INVALID");
    const db = getDb().$client;
    const result = await db.prepare(`
      INSERT INTO support_contacts (name, team, email, phone, hours, sort_order)
      VALUES (?, ?, ?, ?, ?, COALESCE((SELECT max(sort_order) + 1 FROM support_contacts), 0))
      RETURNING id, name, team, email, phone, hours
    `).bind(name, team, typeof body.email === "string" ? body.email.trim() || null : null, typeof body.phone === "string" ? body.phone.trim() || null : null, hours).first();
    return Response.json({ contact: result }, { status: 201 });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
