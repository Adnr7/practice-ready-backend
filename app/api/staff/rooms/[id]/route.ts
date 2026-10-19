import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { parsePositiveId, roomReadinessErrorResponse, updateRoomReadiness, type RoomReadinessState, type RestrictionState } from "@/lib/room-readiness";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const restriction = body?.restriction && typeof body.restriction === "object" ? body.restriction as Record<string, unknown> : undefined;
    const room = await updateRoomReadiness(getDb().$client, {
      roomId: parsePositiveId((await params).id, "Room id"),
      actor: { userId: session.userId, role: session.role },
      state: body?.readinessState as RoomReadinessState | undefined,
      notes: body?.readinessNotes === null || typeof body?.readinessNotes === "string" ? body.readinessNotes as string | null | undefined : undefined,
      restriction: restriction ? {
        activityKey: String(restriction.activityKey ?? ""),
        state: restriction.state as RestrictionState,
        explanation: String(restriction.explanation ?? ""),
      } : undefined,
    });
    return Response.json({ room });
  } catch (error) {
    return roomReadinessErrorResponse(error);
  }
}
