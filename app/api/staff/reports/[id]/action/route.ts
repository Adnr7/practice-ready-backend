import { getDb } from "@/db";
import { getSessionFromRequest } from "@/lib/auth";
import { actOnReport, parseStaffId, readStaffJson, requireStaffActor, staffOperationErrorResponse } from "@/lib/staff-operations";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = getDb().$client;
    const session = await getSessionFromRequest(request, db);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireStaffActor(session);
    const result = await actOnReport(db, session, parseStaffId((await params).id), await readStaffJson(request));
    return Response.json(result, { status: 201 });
  } catch (error) { return staffOperationErrorResponse(error); }
}
