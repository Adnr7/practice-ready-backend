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
import { deriveBookingPhase, getInstitutionNow } from "@/lib/booking-engine";
import { bookingInstant } from "@/lib/room-readiness";
import { assertStudentMovementDesignation, listMovementDestinations } from "@/lib/movement-permissions";

function unauthenticated(): Response {
  return Response.json({ error: "Authentication is required." }, { status: 401 });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return unauthenticated();
    const equipmentId = parseEquipmentId((await params).id);
    const booking = new URL(request.url).searchParams.get("bookingId");
    const bookingId = booking === null ? undefined : parseEquipmentId(booking);
    const destinations = await listMovementDestinations(getDb().$client, session, equipmentId, bookingId);
    return Response.json({ destinations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return movementErrorResponse(error);
  }
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
    const rawBody = await parseJsonBody(request);
    const body = parseCreateMovementBody(rawBody);
    const db = getDb().$client;
    if (session.role === "student") {
      if (!body.bookingId) {
        return Response.json({ error: "Student equipment moves must be linked to an active reservation.", code: "MOVEMENT_BOOKING_REQUIRED" }, { status: 403 });
      }
      const hasEndDate = Boolean((await db.prepare("SELECT 1 AS present FROM pragma_table_info('bookings') WHERE name = 'end_date' LIMIT 1").first<{ present: number }>())?.present);
      const booking = await db.prepare(`
        SELECT b.id, b.user_id AS userId, b.date, ${hasEndDate ? "b.end_date AS endDate," : "NULL AS endDate,"} b.start_time AS startTime, b.end_time AS endTime, b.status,
          e.default_room_id AS defaultRoomId, e.current_location_id AS currentLocationId, r.location_id AS roomLocationId
        FROM bookings b JOIN equipment e ON e.default_room_id = b.room_id JOIN rooms r ON r.id = b.room_id
        WHERE b.id = ? AND e.id = ? LIMIT 1
      `).bind(body.bookingId, equipmentId).first<{ id: number; userId: number | null; date: string; endDate: string | null; startTime: string; endTime: string; status: "confirmed" | "cancelled" | "completed"; defaultRoomId: number | null; currentLocationId: number; roomLocationId: number | null }>();
      if (!booking || booking.userId !== session.userId || booking.status !== "confirmed" || booking.roomLocationId === null || booking.currentLocationId !== booking.roomLocationId || deriveBookingPhase(booking.date, booking.startTime, booking.endTime, booking.status, getInstitutionNow(), null, booking.endDate) !== "in_progress") {
        return Response.json({ error: "The equipment must be present in your active reservation's room.", code: "MOVEMENT_SESSION_NOT_ELIGIBLE" }, { status: 403 });
      }
      if (!body.expectedReturnAt || Date.parse(body.expectedReturnAt) > Date.now() + 3 * 60 * 60 * 1000 || Date.parse(body.expectedReturnAt) > bookingInstant(booking.date, booking.endTime, true, booking.endDate)) {
        return Response.json({ error: "Student moves require a return time within three hours and before the session ends.", code: "MOVEMENT_RETURN_WINDOW_INVALID" }, { status: 400 });
      }
      await assertStudentMovementDesignation(db, equipmentId, body.toLocationId);
    }
    const actor: MovementActor = {
      userId: session.userId,
      role: session.role,
    };
    const movement = await createMovement(db, {
      ...body,
      actor,
      equipmentId,
    });

    return Response.json({ movement }, { status: 201 });
  } catch (error) {
    return movementErrorResponse(error);
  }
}
