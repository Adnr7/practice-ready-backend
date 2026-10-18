import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { getBookingHistory, parseId, workflowErrorResponse } from "@/lib/frontend-workflows";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const history = await getBookingHistory(getDb().$client, parseId((await params).id, "Booking id"), { userId: session.userId, role: session.role });
    return Response.json(history);
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
