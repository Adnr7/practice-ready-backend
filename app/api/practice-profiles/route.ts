import { getDb } from "@/db";
import { env } from "cloudflare:workers";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { FrontendWorkflowError, readJson, requireAdmin, workflowErrorResponse } from "@/lib/frontend-workflows";

export async function GET() {
  try {
    const db = getDb().$client;
    const profiles = await db.prepare("SELECT id, code, name, category, description, version FROM practice_profiles WHERE is_active = 1 ORDER BY id").all();
    const requirements = await db.prepare("SELECT r.id, r.profile_id AS profileId, r.requirement_key AS requirementKey, r.label, r.equipment_type AS equipmentType, r.equipment_name_pattern AS equipmentNamePattern, r.quantity, r.is_hard AS isHard, r.student_supplied AS studentSupplied FROM practice_requirements r JOIN practice_profiles p ON p.id = r.profile_id WHERE p.is_active = 1 ORDER BY r.id").all();
    return Response.json({ profiles: profiles.results, requirements: requirements.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireAdmin({ userId: session.userId, role: session.role });
    const body = await readJson(request);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const category = typeof body.category === "string" ? body.category : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!code || !name || !["vocal", "band", "instrument"].includes(category) || !description) throw new FrontendWorkflowError("code, name, category, and description are required.", 400, "PROFILE_INVALID");
    const db = getDb().$client;
    const profile = await db.prepare("INSERT INTO practice_profiles (code, name, category, description) VALUES (?, ?, ?, ?) RETURNING id, code, name, category, description, version").bind(code, name, category, description).first();
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
