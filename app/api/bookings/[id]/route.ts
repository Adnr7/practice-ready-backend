import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  bookingErrorResponse,
  cancelBooking,
  getBookingView,
  parseBookingId,
  parseVersion,
  rescheduleBooking,
  type BookingActor,
} from "@/lib/booking-lifecycle";

function authRequired(): Response {
  return Response.json({ error: "Authentication required." }, { status: 401 });
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }
    return value as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
}

function actorFromSession(session: NonNullable<Awaited<ReturnType<typeof getSessionFromRequest>>>): BookingActor {
  return { userId: session.userId, role: session.role };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return authRequired();
    const bookingId = parseBookingId((await params).id);
    const booking = await getBookingView(getDb().$client, bookingId);
    if (!booking) return Response.json({ error: "Booking not found." }, { status: 404 });
    const actor = actorFromSession(session);
    if (actor.role === "student" && booking.userId !== actor.userId) {
      return Response.json({ error: "Forbidden: You do not have access to this booking." }, { status: 403 });
    }
    return Response.json({ booking });
  } catch (error) {
    return bookingErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return authRequired();
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const bookingId = parseBookingId((await params).id);
    const roomId = Number(body.roomId);
    const date = typeof body.date === "string" ? body.date.trim() : "";
    const startTime = typeof body.startTime === "string" ? body.startTime.trim() : "";
    const endTime = typeof body.endTime === "string" ? body.endTime.trim() : "";
    if (!Number.isSafeInteger(roomId) || roomId <= 0 || !date || !startTime || !endTime) {
      return Response.json({ error: "roomId, date, startTime, and endTime are required." }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const version = parseVersion(body.version);
    const booking = await rescheduleBooking(getDb().$client, {
      bookingId,
      actor: actorFromSession(session),
      roomId,
      date,
      startTime,
      endTime,
      version,
      reason,
    });
    return Response.json({ booking });
  } catch (error) {
    return bookingErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return authRequired();
    const bookingId = parseBookingId((await params).id);
    let reason: string | undefined;
    let version: number | undefined;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      reason = typeof body.reason === "string" ? body.reason : undefined;
      version = body.version === undefined ? undefined : parseVersion(body.version);
    }
    const result = await cancelBooking(getDb().$client, {
      bookingId,
      actor: actorFromSession(session),
      reason,
      version,
    });
    if (result.alreadyCancelled) {
      return Response.json({ booking: result.booking, message: "Booking is already cancelled." });
    }
    return Response.json({
      success: true,
      booking: result.booking,
      message: "Booking successfully cancelled and time slots have been released.",
    });
  } catch (error) {
    return bookingErrorResponse(error);
  }
}
