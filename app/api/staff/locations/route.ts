import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { FrontendWorkflowError, readJson, requireStaff, workflowErrorResponse } from "@/lib/frontend-workflows";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireStaff({ userId: session.userId, role: session.role });
    const locations = await getDb().$client.prepare("SELECT id, code, name, type FROM locations ORDER BY type, name").all();
    return Response.json({ locations: locations.results });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireStaff({ userId: session.userId, role: session.role });
    const body = await readJson(request);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const type = typeof body.type === "string" ? body.type.trim() : "";
    if (!/^[a-z0-9-]+$/.test(code) || !name || !type) throw new FrontendWorkflowError("code, name, and type are required.", 400, "LOCATION_INVALID");
    const location = await getDb().$client.prepare("INSERT INTO locations (code, name, type) VALUES (?, ?, ?) RETURNING id, code, name, type").bind(code, name, type).first();
    return Response.json({ location }, { status: 201 });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
