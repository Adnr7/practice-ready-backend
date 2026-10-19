import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { FrontendWorkflowError, parseId, readJson, requireAdmin, workflowErrorResponse } from "@/lib/frontend-workflows";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireAdmin({ userId: session.userId, role: session.role });
    const body = await readJson(request);
    const profileId = Number(body.profileId);
    const state = body.state;
    if (!Number.isSafeInteger(profileId) || profileId <= 0 || !["supported", "restricted", "unsupported", "unknown"].includes(String(state))) throw new FrontendWorkflowError("profileId and valid state are required.", 400, "ROOM_PROFILE_INVALID");
    const explanation = typeof body.explanation === "string" ? body.explanation.trim() : "";
    if (!explanation) throw new FrontendWorkflowError("An explanation is required.", 400, "ROOM_PROFILE_EXPLANATION_REQUIRED");
    const roomId = parseId((await params).id, "Room id");
    const db = getDb().$client;
    const result = await db.prepare(`
      INSERT INTO room_practice_types (room_id, profile_id, state, explanation, updated_by_user_id, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(room_id, profile_id) DO UPDATE SET state = excluded.state, explanation = excluded.explanation, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at
      RETURNING id, room_id AS roomId, profile_id AS profileId, state, explanation, updated_at AS updatedAt
    `).bind(roomId, profileId, state, explanation, session.userId).first();
    return Response.json({ practiceType: result });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
