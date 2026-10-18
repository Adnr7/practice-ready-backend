import { getDb } from "@/db";
import { getSessionFromRequest } from "@/lib/auth";
import { getStaffOperations, parseStaffId, readStaffJson, requireStaffActor, saveRoomCatalog, staffOperationErrorResponse } from "@/lib/staff-operations";

async function context(request: Request) {
  const db = getDb().$client;
  const session = await getSessionFromRequest(request, db);
  if (!session) return null;
  requireStaffActor(session);
  return { db, actor: { userId: session.userId, role: session.role } };
}

export async function GET(request: Request) {
  try {
    const ctx = await context(request);
    if (!ctx) return Response.json({ error: "Authentication required." }, { status: 401 });
    return Response.json(await getStaffOperations(ctx.db, ctx.actor), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return staffOperationErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await context(request);
    if (!ctx) return Response.json({ error: "Authentication required." }, { status: 401 });
    return Response.json({ room: await saveRoomCatalog(ctx.db, ctx.actor, await readStaffJson(request)) }, { status: 201 });
  } catch (error) { return staffOperationErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await context(request);
    if (!ctx) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await readStaffJson(request);
    return Response.json({ room: await saveRoomCatalog(ctx.db, ctx.actor, body, parseStaffId(typeof body.id === "number" ? String(body.id) : "")) });
  } catch (error) { return staffOperationErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await context(request);
    if (!ctx) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await readStaffJson(request);
    return Response.json({ room: await saveRoomCatalog(ctx.db, ctx.actor, { isActive: false, reason: body.reason }, parseStaffId(typeof body.id === "number" ? String(body.id) : "")) });
  } catch (error) { return staffOperationErrorResponse(error); }
}
