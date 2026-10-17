import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  listMovements,
  movementErrorResponse,
  type MovementActor,
} from "@/lib/equipment-movements";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) {
      return Response.json({ error: "Authentication is required." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const mineParam = searchParams.get("mine");
    const mine = mineParam !== "false";
    const limitParam = Number(searchParams.get("limit") ?? "50");
    const offsetParam = Number(searchParams.get("offset") ?? "0");
    if (!Number.isSafeInteger(limitParam) || limitParam < 1 || limitParam > 100) {
      return Response.json({ error: "limit must be an integer between 1 and 100." }, { status: 400 });
    }
    if (!Number.isSafeInteger(offsetParam) || offsetParam < 0) {
      return Response.json({ error: "offset must be a non-negative integer." }, { status: 400 });
    }
    if (!mine && session.role === "student") {
      return Response.json({ error: "Only technicians and administrators can list all movements." }, { status: 403 });
    }

    const actor: MovementActor = { userId: session.userId, role: session.role };
    const movements = await listMovements(getDb().$client, actor, {
      mine,
      limit: limitParam,
      offset: offsetParam,
    });
    return Response.json({ movements });
  } catch (error) {
    return movementErrorResponse(error);
  }
}
