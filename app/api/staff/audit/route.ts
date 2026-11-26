import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { requireStaff, workflowErrorResponse } from "@/lib/frontend-workflows";

const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 100_000;
const allowedActions = new Set([
  "booked", "rescheduled", "cancelled", "session_ended", "updated",
  "equipment_moved", "equipment_returned", "equipment_movement_corrected",
  "equipment_movement_updated", "session_equipment_logged",
]);
const clean = (value: string | null, max = 120) => value?.trim().slice(0, max) ?? "";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireStaff({ userId: session.userId, role: session.role });

    const params = new URL(request.url).searchParams;
    const search = clean(params.get("q"), 160);
    const from = clean(params.get("from"), 10);
    const to = clean(params.get("to"), 10);
    const action = clean(params.get("action"), 64);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(params.get("limit") ?? 50) || 50));
    const offset = Math.min(MAX_OFFSET, Math.max(0, Number(params.get("offset") ?? 0) || 0));
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return Response.json({ error: "Use YYYY-MM-DD for the start date." }, { status: 400 });
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return Response.json({ error: "Use YYYY-MM-DD for the end date." }, { status: 400 });
    if (action && !allowedActions.has(action)) return Response.json({ error: "Unknown activity type." }, { status: 400 });
    const clauses: string[] = [];
    const bindings: (string | number)[] = [];
    if (from) { clauses.push("date(a.created_at) >= ?"); bindings.push(from); }
    if (to) { clauses.push("date(a.created_at) <= ?"); bindings.push(to); }
    if (action) { clauses.push("a.action = ?"); bindings.push(action); }
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
      clauses.push("(a.entity_id LIKE ? ESCAPE '\\' OR a.action LIKE ? ESCAPE '\\' OR a.reason LIKE ? ESCAPE '\\' OR a.details LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
      bindings.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const db = getDb().$client;
    const [events, count] = await Promise.all([
      db.prepare(`
        SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.reason,
          a.details, a.created_at AS createdAt, a.actor_user_id AS actorUserId,
          COALESCE(a.details->>'$.actorName', u.full_name) AS actorName,
          COALESCE(a.details->>'$.actorEmail', u.email) AS actorEmail
        FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
        ${where}
        ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?
      `).bind(...bindings, limit, offset).all(),
      db.prepare(`SELECT count(*) AS total FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id ${where}`).bind(...bindings).first<{ total: number }>(),
    ]);
    return Response.json({ events: events.results, total: count?.total ?? 0, limit, offset });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
