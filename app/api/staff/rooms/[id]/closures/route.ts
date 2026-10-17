import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { createRoomClosure, parsePositiveId, roomReadinessErrorResponse } from "@/lib/room-readiness";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    const closure = await createRoomClosure(getDb().$client, {
      roomId: parsePositiveId((await params).id, "Room id"),
      actor: { userId: session.userId, role: session.role },
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      reason: body.reason,
      sourceReportId: body.sourceReportId === undefined ? undefined : Number(body.sourceReportId),
    });
    return Response.json({ closure }, { status: 201 });
  } catch (error) {
    return roomReadinessErrorResponse(error);
  }
}
