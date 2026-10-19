import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { cancelRoomClosure, parsePositiveId, roomReadinessErrorResponse } from "@/lib/room-readiness";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const result = await cancelRoomClosure(getDb().$client, { closureId: parsePositiveId((await params).id, "Closure id"), actor: { userId: session.userId, role: session.role }, reason: typeof body?.reason === "string" ? body.reason : undefined });
    return Response.json(result);
  } catch (error) {
    return roomReadinessErrorResponse(error);
  }
}
