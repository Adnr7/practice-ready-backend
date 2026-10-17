import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { createRepair } from "@/lib/repair-store";
import { parsePositiveId, roomReadinessErrorResponse } from "@/lib/room-readiness";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    const repair = await createRepair(getDb().$client, {
      equipmentId: parsePositiveId((await params).id, "Equipment id"),
      actor: { userId: session.userId, role: session.role },
      expectedReturnAt: body.expectedReturnAt,
      sourceReportId: body.sourceReportId === undefined ? undefined : Number(body.sourceReportId),
      publicMessage: typeof body.publicMessage === "string" ? body.publicMessage : undefined,
      privateNote: typeof body.privateNote === "string" ? body.privateNote : undefined,
    });
    return Response.json({ repair }, { status: 201 });
  } catch (error) {
    return roomReadinessErrorResponse(error);
  }
}
