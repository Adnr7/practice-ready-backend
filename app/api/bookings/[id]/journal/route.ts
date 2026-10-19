import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { getJournal, parseId, readJson, saveJournal, workflowErrorResponse } from "@/lib/frontend-workflows";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const journal = await getJournal(getDb().$client, parseId((await params).id, "Booking id"), { userId: session.userId, role: session.role });
    return Response.json({ journal });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await readJson(request);
    const journal = await saveJournal(getDb().$client, parseId((await params).id, "Booking id"), { userId: session.userId, role: session.role }, { note: body.note, attachmentIds: body.attachmentIds });
    return Response.json({ journal });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
