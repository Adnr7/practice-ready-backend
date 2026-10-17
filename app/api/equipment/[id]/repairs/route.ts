import { getDb } from "@/db";
import { listRepairs } from "@/lib/repair-store";
import { parsePositiveId, roomReadinessErrorResponse } from "@/lib/room-readiness";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json({ repairs: await listRepairs(getDb().$client, parsePositiveId((await params).id, "Equipment id")) });
  } catch (error) {
    return roomReadinessErrorResponse(error);
  }
}
