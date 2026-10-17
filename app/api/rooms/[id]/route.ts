import { getDb } from "@/db";
import { getRoomReadiness, parsePositiveId, roomReadinessErrorResponse } from "@/lib/room-readiness";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const room = await getRoomReadiness(getDb().$client, parsePositiveId((await params).id, "Room id"));
    if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
    return Response.json({ room });
  } catch (error) {
    return roomReadinessErrorResponse(error);
  }
}
