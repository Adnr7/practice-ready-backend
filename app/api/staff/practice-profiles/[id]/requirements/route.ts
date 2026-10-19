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
    const profileId = parseId((await params).id, "Profile id");
    const body = await readJson(request);
    const requirements = Array.isArray(body.requirements) ? body.requirements : null;
    if (!requirements || requirements.length > 50) throw new FrontendWorkflowError("requirements must be an array with at most 50 entries.", 400, "REQUIREMENTS_INVALID");
    const normalized = requirements.map((value, index) => {
      if (!value || typeof value !== "object") throw new FrontendWorkflowError(`Requirement ${index + 1} is invalid.`, 400, "REQUIREMENT_INVALID");
      const item = value as Record<string, unknown>;
      const requirementKey = typeof item.requirementKey === "string" ? item.requirementKey.trim() : "";
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const quantity = Number(item.quantity ?? 1);
      if (!requirementKey || !label || !Number.isSafeInteger(quantity) || quantity < 1) throw new FrontendWorkflowError(`Requirement ${index + 1} needs a key, label, and positive quantity.`, 400, "REQUIREMENT_INVALID");
      return {
        requirementKey,
        label,
        equipmentType: typeof item.equipmentType === "string" ? item.equipmentType.trim() || null : null,
        equipmentNamePattern: typeof item.equipmentNamePattern === "string" ? item.equipmentNamePattern.trim() || null : null,
        quantity,
        isHard: item.isHard === false ? 0 : 1,
        studentSupplied: item.studentSupplied === true ? 1 : 0,
      };
    });
    const db = getDb().$client;
    const profile = await db.prepare("SELECT id FROM practice_profiles WHERE id = ? LIMIT 1").bind(profileId).first<{ id: number }>();
    if (!profile) throw new FrontendWorkflowError("Practice profile not found.", 404, "PROFILE_NOT_FOUND");
    const statements = [db.prepare("DELETE FROM practice_requirements WHERE profile_id = ?").bind(profileId), ...normalized.map((item) => db.prepare(`
      INSERT INTO practice_requirements (profile_id, requirement_key, label, equipment_type, equipment_name_pattern, quantity, is_hard, student_supplied)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(profileId, item.requirementKey, item.label, item.equipmentType, item.equipmentNamePattern, item.quantity, item.isHard, item.studentSupplied))];
    await db.batch(statements);
    return Response.json({ requirements: normalized.map((item) => ({ profileId, ...item })) });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
