import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { getAttachment, parseId, workflowErrorResponse } from "@/lib/frontend-workflows";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const attachment = await getAttachment(getDb().$client, parseId((await params).id, "Attachment id"), { userId: session.userId, role: session.role });
    const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(attachment.dataUrl);
    if (!match || match[1] !== attachment.mediaType) return Response.json({ error: "Attachment data is invalid." }, { status: 500 });
    const encoded = match[2].replace(/\s/g, "");
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new Response(bytes.buffer as ArrayBuffer, { status: 200, headers: { "Content-Type": attachment.mediaType, "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="${attachment.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"` } });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
