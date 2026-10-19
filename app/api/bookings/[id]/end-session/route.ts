import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  bookingErrorResponse,
  endActiveSession,
  parseBookingId,
  parseVersion,
  type BookingActor,
} from "@/lib/booking-lifecycle";

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
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
    const body = await readBody(request);
    const version = body.version === undefined ? undefined : parseVersion(body.version);
    const result = await endActiveSession(getDb().$client, {
      bookingId: parseBookingId((await params).id),
      actor: { userId: session.userId, role: session.role } satisfies BookingActor,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      version,
    });
    return Response.json({ booking: result.booking, alreadyEnded: result.alreadyEnded });
  } catch (error) {
    return bookingErrorResponse(error);
  }
}
