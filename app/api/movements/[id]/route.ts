import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  correctMovement,
  movementErrorResponse,
  parseCorrectionBody,
  parseJsonBody,
  parseMovementId,
  type MovementActor,
} from "@/lib/equipment-movements";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) {
      return Response.json({ error: "Authentication is required." }, { status: 401 });
    }
    if (session.role !== "technician" && session.role !== "admin") {
      return Response.json(
        { error: "Only technicians and administrators can correct movements.", code: "MOVEMENT_FORBIDDEN" },
        { status: 403 },
      );
    }

    const movementId = parseMovementId((await params).id);
    const body = parseCorrectionBody(await parseJsonBody(request));
    const actor: MovementActor = { userId: session.userId, role: session.role };
    const movement = await correctMovement(getDb().$client, {
      ...body,
      actor,
      movementId,
    });
    return Response.json({ movement });
  } catch (error) {
    return movementErrorResponse(error);
  }
}
