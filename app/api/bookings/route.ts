import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { rooms, timeSlots } from "@/db/schema";
import { reserveSlots, reserveSlotsIdempotently, isBookingReferenceConflict, isBookingClaimConflict, reconcileElapsedBookings, type StoredBooking } from "@/lib/booking-store";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  generateBookingReference,
  generateDailyTimeSlots,
  getInstitutionNow,
  isBookingElapsed,
  validateBookingRequest,
  deriveBookingPhase,
  isValidCalendarDate,
} from "@/lib/booking-engine";
import { BOOKABLE_ROOM_CODES } from "@/lib/seed-data";
import { roomIsClosedForWindow } from "@/lib/room-readiness";
import { IdempotencyError, prepareIdempotencyRequest, replayIdempotentResponse } from "@/lib/idempotency";
import { getCurrentBookingPolicy } from "@/lib/booking-policy";
import { operationalConflictResponse } from "@/lib/operational-conflicts";
import { hasColumn, hasRoomReadinessSchema, schemaMigrationResponse } from "@/lib/schema-capabilities";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get("filter"); // upcoming | active | past | all

    const db = getDb();

    // If not logged in, return empty or check guest
    if (!session) {
      return Response.json({ bookings: [] });
    }

    const isAdminOrStaff = session.role === "admin" || session.role === "technician";

    const hasEndDate = await hasColumn(db.$client, "bookings", "end_date");
    const hasPolicyVersion = await hasColumn(db.$client, "bookings", "policy_version");
    const allBookings = await db.$client.prepare(`
      SELECT b.id, b.booking_ref AS bookingRef, b.user_id AS userId,
        b.guest_student_name AS guestStudentName, b.guest_student_id AS guestStudentId,
        b.room_id AS roomId, r.name AS roomName, b.date,
        ${hasEndDate ? "b.end_date" : "b.date"} AS endDate,
        b.start_time AS startTime, b.end_time AS endTime,
        b.duration_minutes AS durationMinutes, ${hasPolicyVersion ? "b.policy_version" : "NULL"} AS policyVersion,
        b.status, b.version, b.session_ended_at AS sessionEndedAt,
        b.cancelled_at AS cancelledAt, b.cancellation_reason AS cancellationReason,
        b.created_at AS createdAt
      FROM bookings b
      LEFT JOIN rooms r ON r.id = b.room_id
      ${isAdminOrStaff ? "" : "WHERE b.user_id = ?"}
      ORDER BY b.date DESC, b.start_time DESC
    `).bind(...(isAdminOrStaff ? [] : [session.userId])).all<{
      id: number;
      bookingRef: string;
      userId: number | null;
      guestStudentName: string | null;
      guestStudentId: string | null;
      roomId: number;
      roomName: string | null;
      date: string;
      endDate: string | null;
      startTime: string;
      endTime: string;
      durationMinutes: number;
      policyVersion: string | null;
      status: "confirmed" | "cancelled" | "completed";
      version: number;
      sessionEndedAt: string | null;
      cancelledAt: string | null;
      cancellationReason: string | null;
      createdAt: string;
    }>().then((result) => result.results);

    const now = getInstitutionNow();

    // Reconcile reservations whose entire window has already elapsed: a
    // "confirmed" booking for a date/time that has passed is no longer active
    // and should not be presented as an active reservation.
    const staleIds = allBookings
      .filter((b) => b.status === "confirmed" && isBookingElapsed(b.date, b.endTime, now, b.endDate ?? undefined))
      .map((b) => b.id);

    await reconcileElapsedBookings(db.$client, staleIds);

    const reconciled = allBookings.map((b) => {
      const status = staleIds.includes(b.id) ? "completed" as const : b.status;
      return {
        ...b,
        endDate: b.endDate ?? b.date,
        status,
        phase: deriveBookingPhase(b.date, b.startTime, b.endTime, status, now, b.sessionEndedAt, b.endDate),
      };
    });

    if (filter === "upcoming") {
      return Response.json({
        bookings: reconciled.filter((b) => b.status === "confirmed"),
      });
    }

    if (filter === "past") {
      return Response.json({
        bookings: reconciled.filter((b) => b.phase === "completed" || b.phase === "cancelled"),
      });
    }

    if (filter === "active") {
      return Response.json({ bookings: reconciled.filter((b) => b.phase === "in_progress") });
    }

    return Response.json({ bookings: reconciled });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) {
      return Response.json({ error: "Sign in is required for operational room reservations." }, { status: 401 });
    }
    let body: Record<string, unknown>;
    try {
      const value: unknown = await request.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
      }
      body = value as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    const roomId = Number(body.roomId);
    const date = typeof body.date === "string" ? body.date.trim() : "";
    const endDate = typeof body.endDate === "string" && body.endDate.trim() ? body.endDate.trim() : undefined;
    const startTime = typeof body.startTime === "string" ? body.startTime.trim() : "";
    const endTime = typeof body.endTime === "string" ? body.endTime.trim() : "";

    if (!Number.isSafeInteger(roomId) || roomId <= 0 || !date || !startTime || !endTime) {
      return Response.json(
        { error: "roomId, date, startTime, and endTime are required fields." },
        { status: 400 }
      );
    }

    // Only immutable input checks precede replay. Published policy, the clock,
    // room activation/closures, and availability may have changed since creation.
    if (!isValidCalendarDate(date)) {
      return Response.json({ error: "Invalid date. Expected a real calendar date in YYYY-MM-DD format." }, { status: 400 });
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
      return Response.json({ error: "Invalid time format. Expected HH:MM." }, { status: 400 });
    }
    const db = getDb();
    if (!(await hasRoomReadinessSchema(db.$client))) {
      return schemaMigrationResponse("Room readiness migration is required before creating reservations.", { migration: "0006_room_readiness.sql" });
    }
    const idempotency = await prepareIdempotencyRequest(session.userId, "booking.create", request.headers.get("Idempotency-Key"), body);
    const replay = await replayIdempotentResponse(db.$client, idempotency);
    if (replay) return replay;
    const policy = await getCurrentBookingPolicy(db.$client);

    // Validate the currently published university booking policy.
    const validation = validateBookingRequest({ date, endDate, startTime, endTime }, getInstitutionNow(), policy);
    if (!validation.valid || !validation.requiredSlots) {
      return Response.json(
        { error: validation.error ?? "Invalid booking request parameters." },
        { status: 400 }
      );
    }
    if (validation.endDate && validation.endDate !== date && !(await hasColumn(db.$client, "bookings", "end_date"))) {
      return schemaMigrationResponse("Overnight reservations require the overnight booking migration.", { migration: "0011_asmi_overnight_bookings.sql" });
    }

    // Verify target room exists and is active
    const [room] = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.isActive, true)))
      .limit(1);

    if (!room || !BOOKABLE_ROOM_CODES.includes(room.code as typeof BOOKABLE_ROOM_CODES[number])) {
      return Response.json({ error: "Selected room does not exist or is inactive." }, { status: 404 });
    }

    if (await roomIsClosedForWindow(db.$client, roomId, date, startTime, endTime, validation.endDate)) {
      return Response.json({ error: "This room is closed or unavailable during the requested time.", code: "ROOM_CLOSED" }, { status: 409 });
    }

    const userId = session.userId;
    const guestStudentName = null;
    const guestStudentId = null;

    // Fill every calendar date touched by an overnight request without
    // appending another copy of a legacy grid.
    const slotDates = [...new Set((validation.requiredSlotRefs ?? []).map((slot) => slot.date))];
    for (const slotDate of slotDates) {
      const dailySlots = generateDailyTimeSlots(roomId, slotDate);
      const existingSlots = await db.select({ startTime: timeSlots.startTime }).from(timeSlots)
        .where(and(eq(timeSlots.roomId, roomId), eq(timeSlots.date, slotDate)));
      const existingStartTimes = new Set(existingSlots.map((slot) => slot.startTime));
      const missingSlots = dailySlots.filter((slot) => !existingStartTimes.has(slot.startTime));
      for (let i = 0; i < missingSlots.length; i += 10) {
        await db.insert(timeSlots).values(missingSlots.slice(i, i + 10)).onConflictDoNothing();
      }
    }

    let newBooking: StoredBooking | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const booking = {
          bookingRef: generateBookingReference(),
          userId, guestStudentName, guestStudentId, roomId, date, endDate: validation.endDate, startTime, endTime,
          durationMinutes: validation.durationMinutes!,
          policyVersion: policy.version,
        };
        if (idempotency) {
          const response = await reserveSlotsIdempotently(db.$client, booking, validation.requiredSlotRefs ?? validation.requiredSlots, idempotency, room.name);
          if (response) return response;
        } else {
          newBooking = await reserveSlots(db.$client, booking, validation.requiredSlotRefs ?? validation.requiredSlots);
        }
      } catch (error) {
        if ((isBookingReferenceConflict(error) || isBookingClaimConflict(error)) && attempt < 4) continue;
        throw error;
      }

      if (!newBooking) {
        const conflicts = await Promise.all((validation.requiredSlotRefs ?? []).map((slot) => db.select({ startTime: timeSlots.startTime, status: timeSlots.status }).from(timeSlots).where(and(
          eq(timeSlots.roomId, roomId), eq(timeSlots.date, slot.date), eq(timeSlots.startTime, slot.startTime),
        )).limit(1)));
        const conflictingSlots = (validation.requiredSlotRefs ?? []).filter((_, index) => conflicts[index][0]?.status !== "available").map((slot) => slot.startTime);
        return Response.json(
          {
            error: "Booking conflict detected: One or more selected time slots have already been reserved.",
            conflictingSlots,
          },
          { status: 409 },
        );
      }
      break;
    }

    if (!newBooking) throw new Error("Could not generate a unique booking reference.");

    const responseBody = {
        booking: {
          id: newBooking.id,
          bookingRef: newBooking.bookingRef,
          roomId: newBooking.roomId,
          roomName: room.name,
           date: newBooking.date,
           endDate: newBooking.endDate ?? validation.endDate,
          startTime: newBooking.startTime,
           endTime: newBooking.endTime,
           durationMinutes: newBooking.durationMinutes,
           policyVersion: newBooking.policyVersion,
          guestStudentName: newBooking.guestStudentName,
          status: newBooking.status,
          createdAt: newBooking.createdAt,
        },
      };
    return Response.json(responseBody, { status: 201 });
  } catch (error) {
    if (error instanceof IdempotencyError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const conflict = operationalConflictResponse(error);
    if (conflict) return conflict;
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
