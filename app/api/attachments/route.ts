import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { createAttachment, readJson, workflowErrorResponse } from "@/lib/frontend-workflows";

export async function POST(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const attachment = await createAttachment(getDb().$client, { userId: session.userId, role: session.role }, await readJson(request));
    return Response.json({ attachment }, { status: 201 });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
