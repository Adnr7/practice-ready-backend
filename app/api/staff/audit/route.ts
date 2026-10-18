import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { requireStaff, workflowErrorResponse } from "@/lib/frontend-workflows";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireStaff({ userId: session.userId, role: session.role });
    const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 50)));
    const events = await getDb().$client.prepare(`
      SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.reason,
        a.details, a.created_at AS createdAt, a.actor_user_id AS actorUserId, u.full_name AS actorName
      FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT ?
    `).bind(limit).all();
    return Response.json({ events: events.results });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
