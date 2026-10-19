import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { FrontendWorkflowError, parseId, readJson, requireAdmin, workflowErrorResponse } from "@/lib/frontend-workflows";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireAdmin({ userId: session.userId, role: session.role });
    const body = await readJson(request);
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") throw new FrontendWorkflowError("isActive must be boolean.", 400, "PROFILE_INVALID");
    const db = getDb().$client;
    const profileId = parseId((await params).id, "Profile id");
    const profile = await db.prepare(`
      UPDATE practice_profiles SET name = COALESCE(?, name), description = COALESCE(?, description), is_active = COALESCE(?, is_active), version = version + 1
      WHERE id = ? RETURNING id, code, name, category, description, is_active AS isActive, version
    `).bind(typeof body.name === "string" ? body.name.trim() : null, typeof body.description === "string" ? body.description.trim() : null, body.isActive === undefined ? null : body.isActive ? 1 : 0, profileId).first();
    if (!profile) return Response.json({ error: "Practice profile not found." }, { status: 404 });
    return Response.json({ profile });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireAdmin({ userId: session.userId, role: session.role });
    const body = await readJson(request);
    const profileId = parseId((await params).id, "Profile id");
    if (typeof body.requirementKey !== "string" || typeof body.label !== "string") throw new FrontendWorkflowError("requirementKey and label are required.", 400, "REQUIREMENT_INVALID");
    const requirement = await getDb().$client.prepare(`
      INSERT INTO practice_requirements (profile_id, requirement_key, label, equipment_type, equipment_name_pattern, quantity, is_hard, student_supplied)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, profile_id AS profileId, requirement_key AS requirementKey, label, equipment_type AS equipmentType, equipment_name_pattern AS equipmentNamePattern, quantity, is_hard AS isHard, student_supplied AS studentSupplied
    `).bind(profileId, body.requirementKey.trim(), body.label.trim(), body.equipmentType ?? null, body.equipmentNamePattern ?? null, Number(body.quantity ?? 1), body.isHard === false ? 0 : 1, body.studentSupplied ? 1 : 0).first();
    return Response.json({ requirement }, { status: 201 });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
