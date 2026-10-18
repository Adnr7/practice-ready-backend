import { env } from "cloudflare:workers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, rooms, timeSlots } from "@/db/schema";
import { reserveSlots, reserveSlotsIdempotently, isBookingReferenceConflict, isBookingClaimConflict, type StoredBooking } from "@/lib/booking-store";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  generateBookingReference,
  generateDailyTimeSlots,
  getInstitutionNow,
  isBookingElapsed,
  validateBookingRequest,
  deriveBookingPhase,
  isValidCalendarDate,
  normalizeEndMinutes,
  timeToMinutes,
} from "@/lib/booking-engine";
import { roomIsClosedForWindow } from "@/lib/room-readiness";
import { IdempotencyError, prepareIdempotencyRequest, replayIdempotentResponse } from "@/lib/idempotency";
import { getCurrentBookingPolicy } from "@/lib/booking-policy";
import { operationalConflictResponse } from "@/lib/operational-conflicts";

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

    const baseQuery = db
      .select({
        id: bookings.id,
        bookingRef: bookings.bookingRef,
        userId: bookings.userId,
        guestStudentName: bookings.guestStudentName,
        guestStudentId: bookings.guestStudentId,
        roomId: bookings.roomId,
        roomName: rooms.name,
        date: bookings.date,
        startTime: bookings.startTime,
         endTime: bookings.endTime,
         durationMinutes: bookings.durationMinutes,
         policyVersion: bookings.policyVersion,
        status: bookings.status,
        version: bookings.version,
        sessionEndedAt: bookings.sessionEndedAt,
        cancelledAt: bookings.cancelledAt,
        cancellationReason: bookings.cancellationReason,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .leftJoin(rooms, eq(bookings.roomId, rooms.id));

    const userCondition = isAdminOrStaff ? undefined : eq(bookings.userId, session.userId);
    const allBookings = userCondition
      ? await baseQuery.where(userCondition).orderBy(desc(bookings.date), desc(bookings.startTime))
      : await baseQuery.orderBy(desc(bookings.date), desc(bookings.startTime));

    const now = getInstitutionNow();

    // Reconcile reservations whose entire window has already elapsed: a
    // "confirmed" booking for a date/time that has passed is no longer active
    // and should not be presented as an active reservation.
    const staleIds = allBookings
      .filter((b) => b.status === "confirmed" && isBookingElapsed(b.date, b.endTime, now))
      .map((b) => b.id);

    if (staleIds.length > 0) {
      await db
        .update(bookings)
        .set({ status: "completed" })
        .where(inArray(bookings.id, staleIds));
    }

    const reconciled = allBookings.map((b) => {
      const status = staleIds.includes(b.id) ? "completed" as const : b.status;
      return {
        ...b,
        status,
        phase: deriveBookingPhase(b.date, b.startTime, b.endTime, status, now, b.sessionEndedAt),
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
    if (normalizeEndMinutes(endTime) <= timeToMinutes(startTime)) {
      return Response.json({ error: "End time must be after start time." }, { status: 400 });
    }

    const db = getDb();
    const idempotency = await prepareIdempotencyRequest(session.userId, "booking.create", request.headers.get("Idempotency-Key"), body);
    const replay = await replayIdempotentResponse(db.$client, idempotency);
    if (replay) return replay;
    const policy = await getCurrentBookingPolicy(db.$client);

    // Validate the currently published university booking policy.
    const validation = validateBookingRequest({ date, startTime, endTime }, getInstitutionNow(), policy);
    if (!validation.valid || !validation.requiredSlots) {
      return Response.json(
        { error: validation.error ?? "Invalid booking request parameters." },
        { status: 400 }
      );
    }

    // Verify target room exists and is active
    const [room] = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.isActive, true)))
      .limit(1);

    if (!room) {
      return Response.json({ error: "Selected room does not exist or is inactive." }, { status: 404 });
    }

    if (await roomIsClosedForWindow(db.$client, roomId, date, startTime, endTime)) {
      return Response.json({ error: "This room is closed or unavailable during the requested time.", code: "ROOM_CLOSED" }, { status: 409 });
    }

    const userId = session.userId;
    const guestStudentName = null;
    const guestStudentId = null;

    // Fill missing rows without appending another copy of an old grid when a
    // legacy database has not received the unique index migration yet.
    const dailySlots = generateDailyTimeSlots(roomId, date);
    const existingSlots = await db
      .select({ startTime: timeSlots.startTime })
      .from(timeSlots)
      .where(and(eq(timeSlots.roomId, roomId), eq(timeSlots.date, date)));
    const existingStartTimes = new Set(existingSlots.map((slot) => slot.startTime));
    const missingSlots = dailySlots.filter((slot) => !existingStartTimes.has(slot.startTime));
    for (let i = 0; i < missingSlots.length; i += 10) {
      await db.insert(timeSlots).values(missingSlots.slice(i, i + 10)).onConflictDoNothing();
    }

    let newBooking: StoredBooking | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const booking = {
          bookingRef: generateBookingReference(),
          userId, guestStudentName, guestStudentId, roomId, date, startTime, endTime,
          durationMinutes: validation.durationMinutes!,
          policyVersion: policy.version,
        };
        if (idempotency) {
          const response = await reserveSlotsIdempotently(db.$client, booking, validation.requiredSlots, idempotency, room.name);
          if (response) return response;
        } else {
          newBooking = await reserveSlots(db.$client, booking, validation.requiredSlots);
        }
      } catch (error) {
        if ((isBookingReferenceConflict(error) || isBookingClaimConflict(error)) && attempt < 4) continue;
        throw error;
      }

      if (!newBooking) {
        const slots = await db.select().from(timeSlots).where(and(
          eq(timeSlots.roomId, roomId), eq(timeSlots.date, date),
          inArray(timeSlots.startTime, validation.requiredSlots),
        ));
        const conflictingSlots = validation.requiredSlots.filter((startTime) =>
          !slots.some((slot) => slot.startTime === startTime && slot.status === "available"),
        );
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
