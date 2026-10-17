import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  createMovement,
  movementErrorResponse,
  parseCreateMovementBody,
  parseEquipmentId,
  parseJsonBody,
  type MovementActor,
} from "@/lib/equipment-movements";

function unauthenticated(): Response {
  return Response.json({ error: "Authentication is required." }, { status: 401 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return unauthenticated();

    const equipmentId = parseEquipmentId((await params).id);
    const body = parseCreateMovementBody(await parseJsonBody(request));
    const actor: MovementActor = {
      userId: session.userId,
      role: session.role,
    };
    const movement = await createMovement(getDb().$client, {
      ...body,
      actor,
      equipmentId,
    });

    return Response.json({ movement }, { status: 201 });
  } catch (error) {
    return movementErrorResponse(error);
  }
}
