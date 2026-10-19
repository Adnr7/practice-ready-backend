import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { parseBookingId, type BookingActor } from "@/lib/booking-lifecycle";
import {
  listSessionEquipmentUsage,
  parseEquipmentUsageBody,
  recordSessionEquipmentUsage,
  sessionUsageErrorResponse,
} from "@/lib/session-equipment-usage";

function actor(session: NonNullable<Awaited<ReturnType<typeof getSessionFromRequest>>>): BookingActor {
  return { userId: session.userId, role: session.role };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const usage = await listSessionEquipmentUsage(getDb().$client, parseBookingId((await params).id), actor(session));
    return Response.json({ usage });
  } catch (error) {
    return sessionUsageErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json().catch(() => null);
    const { equipmentIds } = parseEquipmentUsageBody(body);
    const result = await recordSessionEquipmentUsage(getDb().$client, {
      bookingId: parseBookingId((await params).id),
      actor: actor(session),
      equipmentIds,
    });
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return sessionUsageErrorResponse(error);
  }
}
