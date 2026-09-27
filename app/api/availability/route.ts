import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { rooms, timeSlots } from "@/db/schema";
import { generateDailyTimeSlots, type TimePeriod } from "@/lib/booking-engine";

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

    const roomId = parseInt(roomIdParam, 10);
    if (isNaN(roomId) || roomId <= 0) {
      return Response.json(
        { error: "roomId must be a positive integer." },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return Response.json(
        { error: "date must be in YYYY-MM-DD format." },
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

    // Query existing slots
    let slots = await db
      .select()
      .from(timeSlots)
      .where(and(eq(timeSlots.roomId, roomId), eq(timeSlots.date, dateParam)))
      .orderBy(timeSlots.startTime);

    // Auto-generate standard daily slots if none exist yet for this date
    if (slots.length === 0) {
      const generated = generateDailyTimeSlots(roomId, dateParam);
      await db.insert(timeSlots).values(generated);

      slots = await db
        .select()
        .from(timeSlots)
        .where(and(eq(timeSlots.roomId, roomId), eq(timeSlots.date, dateParam)))
        .orderBy(timeSlots.startTime);
    }

    const periods: Record<TimePeriod, typeof slots> = {
      "early-morning": [],
      morning: [],
      afternoon: [],
      evening: [],
      night: [],
      "late-night": [],
    };

    for (const slot of slots) {
      const p = slot.period as TimePeriod;
      if (periods[p]) {
        periods[p].push(slot);
      }
    }

    return Response.json({
      room,
      date: dateParam,
      periods,
      slots,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
