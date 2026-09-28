import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, bookingSlots, rooms, timeSlots } from "@/db/schema";
import { getSessionFromRequest } from "@/lib/auth";
import {
  generateBookingReference,
  generateDailyTimeSlots,
  validateBookingRequest,
} from "@/lib/booking-engine";

export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get("filter"); // upcoming | past | all

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
        status: bookings.status,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .leftJoin(rooms, eq(bookings.roomId, rooms.id));

    const userCondition = isAdminOrStaff ? undefined : eq(bookings.userId, session.userId);
    const allBookings = userCondition
      ? await baseQuery.where(userCondition).orderBy(desc(bookings.date), desc(bookings.startTime))
      : await baseQuery.orderBy(desc(bookings.date), desc(bookings.startTime));

    const today = new Date().toISOString().split("T")[0];

    if (filter === "upcoming") {
      return Response.json({
        bookings: allBookings.filter((b) => b.date >= today && b.status === "confirmed"),
      });
    }

    if (filter === "past") {
      return Response.json({
        bookings: allBookings.filter((b) => b.date < today || b.status !== "confirmed"),
      });
    }

    return Response.json({ bookings: allBookings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      roomId?: number;
      date?: string;
      startTime?: string;
      endTime?: string;
      guestName?: string;
      guestStudentId?: string;
    };

    const roomId = Number(body.roomId);
    const date = body.date?.trim();
    const startTime = body.startTime?.trim();
    const endTime = body.endTime?.trim();

    if (!roomId || !date || !startTime || !endTime) {
      return Response.json(
        { error: "roomId, date, startTime, and endTime are required fields." },
        { status: 400 }
      );
    }

    // Validate university booking rules
    const validation = validateBookingRequest({ date, startTime, endTime });
    if (!validation.valid || !validation.requiredSlots) {
      return Response.json(
        { error: validation.error ?? "Invalid booking request parameters." },
        { status: 400 }
      );
    }

    const db = getDb();

    // Verify target room exists and is active
    const [room] = await db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.isActive, true)))
      .limit(1);

    if (!room) {
      return Response.json({ error: "Selected room does not exist or is inactive." }, { status: 404 });
    }

    // Identify user or fallback to guest for evaluation demo
    const session = await getSessionFromRequest(request);
    const userId = session?.userId ?? null;
    const guestStudentName = userId ? null : (body.guestName?.trim() || "Student Practice User");
    const guestStudentId = userId ? null : (body.guestStudentId?.trim() || "TSM-2026-GUEST");

    // Fetch existing slots for this room & date
    let existingSlots = await db
      .select()
      .from(timeSlots)
      .where(and(eq(timeSlots.roomId, roomId), eq(timeSlots.date, date)));

    // If slots not yet generated for date, create them
    if (existingSlots.length === 0) {
      const dailySlots = generateDailyTimeSlots(roomId, date);
      for (let i = 0; i < dailySlots.length; i += 10) {
        await db.insert(timeSlots).values(dailySlots.slice(i, i + 10));
      }

      existingSlots = await db
        .select()
        .from(timeSlots)
        .where(and(eq(timeSlots.roomId, roomId), eq(timeSlots.date, date)));
    }

    // Find requested slots
    const targetSlots = existingSlots.filter((s) => validation.requiredSlots!.includes(s.startTime));

    // Check for conflicts
    const conflictingSlots = targetSlots
      .filter((s) => s.status !== "available")
      .map((s) => s.startTime);

    if (conflictingSlots.length > 0) {
      return Response.json(
        {
          error: "Booking conflict detected: One or more selected time slots have already been reserved.",
          conflictingSlots,
        },
        { status: 409 }
      );
    }

    // If any requested slot is somehow missing from generated slots
    if (targetSlots.length !== validation.requiredSlots.length) {
      return Response.json(
        { error: "One or more requested time slots are outside bookable hours." },
        { status: 400 }
      );
    }

    // Atomic insert booking + booking_slots + update time_slots
    const bookingRef = generateBookingReference();

    const [newBooking] = await db
      .insert(bookings)
      .values({
        bookingRef,
        userId,
        guestStudentName,
        guestStudentId,
        roomId,
        date,
        startTime,
        endTime,
        durationMinutes: validation.durationMinutes!,
        status: "confirmed",
      })
      .returning();

    // Link booking to time slots
    const slotLinks = targetSlots.map((slot) => ({
      bookingId: newBooking.id,
      timeSlotId: slot.id,
    }));
    await db.insert(bookingSlots).values(slotLinks);

    // Mark slots as booked
    const targetSlotIds = targetSlots.map((s) => s.id);
    await db
      .update(timeSlots)
      .set({ status: "booked" })
      .where(inArray(timeSlots.id, targetSlotIds));

    return Response.json(
      {
        booking: {
          id: newBooking.id,
          bookingRef: newBooking.bookingRef,
          roomId: newBooking.roomId,
          roomName: room.name,
          date: newBooking.date,
          startTime: newBooking.startTime,
          endTime: newBooking.endTime,
          durationMinutes: newBooking.durationMinutes,
          status: newBooking.status,
          createdAt: newBooking.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
