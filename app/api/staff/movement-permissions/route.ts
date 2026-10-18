import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { movementErrorResponse, parseJsonBody } from "@/lib/equipment-movements";
import { listMovementPermissions, saveMovementPermission } from "@/lib/movement-permissions";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const permissions = await listMovementPermissions(getDb().$client, session);
    return Response.json({ permissions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return movementErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication is required." }, { status: 401 });
    const permission = await saveMovementPermission(getDb().$client, session, await parseJsonBody(request));
    return Response.json({ permission }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return movementErrorResponse(error);
  }
}
