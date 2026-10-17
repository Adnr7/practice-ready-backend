import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { updateRepair, type RepairStage } from "@/lib/repair-store";
import { parsePositiveId, roomReadinessErrorResponse } from "@/lib/room-readiness";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.stage !== "string") return Response.json({ error: "stage is required." }, { status: 400 });
    const repair = await updateRepair(getDb().$client, {
      repairId: parsePositiveId((await params).id, "Repair id"),
      actor: { userId: session.userId, role: session.role },
      stage: body.stage as RepairStage,
      expectedReturnAt: body.expectedReturnAt,
      publicMessage: typeof body.publicMessage === "string" ? body.publicMessage : undefined,
      privateNote: typeof body.privateNote === "string" ? body.privateNote : undefined,
      inspectionId: body.inspectionId === undefined ? undefined : Number(body.inspectionId),
    });
    return Response.json({ repair });
  } catch (error) {
    return roomReadinessErrorResponse(error);
  }
}
