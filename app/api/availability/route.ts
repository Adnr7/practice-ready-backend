import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { bookingSlots, bookings, rooms, timeSlots, users } from "@/db/schema";
import {
  generateDailyTimeSlots,
  getInstitutionNow,
  isStartInPast,
  isValidCalendarDate,
  type TimePeriod,
} from "@/lib/booking-engine";
import { bookingInstant } from "@/lib/room-readiness";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const roomIdParam = searchParams.get("roomId");
    const dateParam = searchParams.get("date");

    if (!roomIdParam || !dateParam) {
      return Response.json(
        { error: "roomId and date query parameters are required." },
        { status: 400 }
      );
    }

    const roomId = Number(roomIdParam);
    if (!Number.isSafeInteger(roomId) || roomId <= 0) {
      return Response.json(
        { error: "roomId must be a positive integer." },
        { status: 400 }
      );
    }

    if (!isValidCalendarDate(dateParam)) {
      return Response.json(
        { error: "date must be a real calendar date in YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    const db = getDb();

    // Verify room exists
    const [room] = await db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      return Response.json({ error: "Room not found." }, { status: 404 });
    }

    const roomState = await db.$client.prepare("SELECT readiness_state AS readinessState FROM rooms WHERE id = ? LIMIT 1").bind(roomId).first<{ readinessState: string }>();
    const closures = await db.$client.prepare("SELECT starts_at AS startsAt, ends_at AS endsAt FROM room_closures WHERE room_id = ? AND is_active = 1").bind(roomId).all<{ startsAt: string; endsAt: string }>();
    const roomClosed = roomState?.readinessState === "closed";

    const now = getInstitutionNow();
    const isPastDate = dateParam < now.date;
    const isToday = dateParam === now.date;

    type SlotRow = typeof timeSlots.$inferSelect;
    let slots: SlotRow[];

    if (isPastDate) {
      // Past schedules are read-only: build the standard grid in memory
      // rather than persisting rows for a day that can never be booked.
      slots = generateDailyTimeSlots(roomId, dateParam).map((slot, index) => ({
        id: -(index + 1),
        ...slot,
      }));
    } else {
      slots = await db
        .select()
        .from(timeSlots)
        .where(and(eq(timeSlots.roomId, roomId), eq(timeSlots.date, dateParam)))
        .orderBy(timeSlots.startTime);

      // Auto-generate standard daily slots if none exist yet for this date
      if (slots.length < 48) {
        const existingStartTimes = new Set(slots.map((slot) => slot.startTime));
        const generated = generateDailyTimeSlots(roomId, dateParam).filter(
          (slot) => !existingStartTimes.has(slot.startTime),
        );
        for (let i = 0; i < generated.length; i += 10) {
          await db.insert(timeSlots).values(generated.slice(i, i + 10)).onConflictDoNothing();
        }

        slots = await db
          .select()
          .from(timeSlots)
          .where(and(eq(timeSlots.roomId, roomId), eq(timeSlots.date, dateParam)))
          .orderBy(timeSlots.startTime);
      }
    }

    // Older databases may contain both the original 06:00-24:00 grid and a
    // regenerated full-day grid. Treat duplicate start times as one logical
    // slot until the database migration can enforce its unique index.
    const statusPriority: Record<SlotRow["status"], number> = {
      booked: 0,
      maintenance: 1,
      available: 2,
    };
    const uniqueSlots = new Map<string, SlotRow>();
    for (const slot of slots) {
      const current = uniqueSlots.get(slot.startTime);
      if (
        !current ||
        statusPriority[slot.status] < statusPriority[current.status] ||
        (slot.status === current.status && slot.id < current.id)
      ) {
        uniqueSlots.set(slot.startTime, slot);
      }
    }
    slots = [...uniqueSlots.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));

    // Resolve the display name of the confirmed booking holding each booked slot
    // so clients can show who is in the room.
    const bookedSlotIds = slots
      .filter((slot) => slot.status === "booked")
      .map((slot) => slot.id);

    const bookedByBySlotId = new Map<number, string>();
    if (bookedSlotIds.length > 0) {
      const links = await db
        .select({
          timeSlotId: bookingSlots.timeSlotId,
          userName: users.fullName,
          guestName: bookings.guestStudentName,
          bookingStatus: bookings.status,
        })
        .from(bookingSlots)
        .innerJoin(bookings, eq(bookingSlots.bookingId, bookings.id))
        .leftJoin(users, eq(bookings.userId, users.id))
        .where(inArray(bookingSlots.timeSlotId, bookedSlotIds));

      for (const link of links) {
        if (link.bookingStatus !== "confirmed") continue;
        const name = link.userName ?? link.guestName;
        if (name) bookedByBySlotId.set(link.timeSlotId, name);
      }
    }

    // A slot whose start time has already passed (or that belongs to a past
    // date) can no longer be reserved. Report it as unavailable so clients
    // disable it, while leaving the underlying database rows untouched.
    const responseSlots = slots.map((slot) => {
      const passed =
        isPastDate || (isToday && isStartInPast(dateParam, slot.startTime, now));
      const slotStart = bookingInstant(dateParam, slot.startTime);
      const slotEnd = bookingInstant(dateParam, slot.endTime);
      const closed = roomClosed || closures.results.some((closure) => Date.parse(closure.startsAt) < slotEnd && Date.parse(closure.endsAt) > slotStart);
      return {
        ...slot,
        status:
          closed && slot.status === "available" ? ("maintenance" as const) : passed && slot.status === "available" ? ("booked" as const) : slot.status,
        passed,
        bookedBy: slot.status === "booked" ? (bookedByBySlotId.get(slot.id) ?? null) : null,
      };
    });

    const periods: Record<TimePeriod, typeof responseSlots> = {
      "early-morning": [],
      morning: [],
      afternoon: [],
      evening: [],
      night: [],
      "late-night": [],
    };

    for (const slot of responseSlots) {
      const p = slot.period as TimePeriod;
      if (periods[p]) {
        periods[p].push(slot);
      }
    }

    return Response.json({
      room,
      date: dateParam,
      periods,
      slots: responseSlots,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
