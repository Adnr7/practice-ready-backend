import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { recordInspection } from "@/lib/repair-store";
import { parsePositiveId, roomReadinessErrorResponse } from "@/lib/room-readiness";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || (body.result !== "passed" && body.result !== "failed") || typeof body.condition !== "string") {
      return Response.json({ error: "result and condition are required." }, { status: 400 });
    }
    const inspection = await recordInspection(getDb().$client, {
      equipmentId: parsePositiveId((await params).id, "Equipment id"),
      actor: { userId: session.userId, role: session.role },
      result: body.result,
      condition: body.condition,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      repairJobId: body.repairJobId === undefined ? undefined : Number(body.repairJobId),
    });
    return Response.json({ inspection }, { status: 201 });
  } catch (error) {
    return roomReadinessErrorResponse(error);
  }
}
