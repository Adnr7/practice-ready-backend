import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { bookingErrorResponse, parseBookingId, parseVersion, rescheduleBooking } from "@/lib/booking-lifecycle";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
    const roomId = Number(body.roomId);
    const date = typeof body.date === "string" ? body.date.trim() : "";
    const startTime = typeof body.startTime === "string" ? body.startTime.trim() : "";
    const endTime = typeof body.endTime === "string" ? body.endTime.trim() : "";
    if (!Number.isSafeInteger(roomId) || roomId <= 0 || !date || !startTime || !endTime) {
      return Response.json({ error: "roomId, date, startTime, and endTime are required." }, { status: 400 });
    }
    const booking = await rescheduleBooking(getDb().$client, {
      bookingId: parseBookingId((await params).id),
      actor: { userId: session.userId, role: session.role },
      roomId,
      date,
      startTime,
      endTime,
      version: parseVersion(body.version),
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
    return Response.json({ booking });
  } catch (error) {
    return bookingErrorResponse(error);
  }
}
