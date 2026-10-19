import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  movementErrorResponse,
  parseJsonBody,
  parseMovementId,
  parseReturnMovementBody,
  returnMovement,
  type MovementActor,
} from "@/lib/equipment-movements";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) {
      return Response.json({ error: "Authentication is required." }, { status: 401 });
    }

    const movementId = parseMovementId((await params).id);
    const body = parseReturnMovementBody(await parseJsonBody(request));
    const actor: MovementActor = { userId: session.userId, role: session.role };
    const movement = await returnMovement(getDb().$client, {
      ...body,
      actor,
      movementId,
    });
    return Response.json({ movement });
  } catch (error) {
    return movementErrorResponse(error);
  }
}
