import { getDb } from "@/db";
import { getSessionFromRequest } from "@/lib/auth";
import { parseStaffId, readStaffJson, requireStaffActor, saveEquipmentCatalog, staffOperationErrorResponse } from "@/lib/staff-operations";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = getDb().$client;
    const session = await getSessionFromRequest(request, db);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireStaffActor(session);
    const equipment = await saveEquipmentCatalog(db, session, await readStaffJson(request), parseStaffId((await params).id));
    return Response.json({ equipment });
  } catch (error) { return staffOperationErrorResponse(error); }
}
