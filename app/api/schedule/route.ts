import { and, asc, eq, gte, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, rooms, users } from "@/db/schema";
import { getInstitutionNow, isValidCalendarDate } from "@/lib/booking-engine";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const date = dateParam ?? getInstitutionNow().date;

    if (!isValidCalendarDate(date)) {
      return Response.json(
        { error: "date must be a real calendar date in YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    // The operational day runs 06:00-06:00: daytime bookings live on this
    // calendar date, the late-night tail (00:00-06:00) on the next one.
    const baseDate = new Date(`${date}T00:00:00Z`);
    const nextDate = new Date(baseDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const nextDateStr = nextDate.toISOString().split("T")[0];

    const db = getDb();

    const activeRooms = await db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(eq(rooms.isActive, true))
      .orderBy(asc(rooms.id));

    const rows = await db
      .select({
        roomId: bookings.roomId,
        bookingRef: bookings.bookingRef,
        startTime: bookings.startTime,
        endTime: bookings.endTime,
        guestName: bookings.guestStudentName,
        userName: users.fullName,
      })
      .from(bookings)
      .leftJoin(users, eq(bookings.userId, users.id))
      .where(
        and(
          eq(bookings.status, "confirmed"),
          or(
            and(eq(bookings.date, date), gte(bookings.startTime, "06:00")),
            and(eq(bookings.date, nextDateStr), lt(bookings.startTime, "06:00"))
          )
        )
      )
      .orderBy(asc(bookings.startTime));

    const byRoom = new Map<
      number,
      { bookingRef: string; startTime: string; endTime: string; bookedBy: string }[]
    >();
    for (const row of rows) {
      const list = byRoom.get(row.roomId) ?? [];
      list.push({
        bookingRef: row.bookingRef,
        startTime: row.startTime,
        endTime: row.endTime,
        bookedBy: row.userName ?? row.guestName ?? "Student",
      });
      byRoom.set(row.roomId, list);
    }

    // Operational-day order: daytime slots first (06:00-24:00), then the
    // late-night tail of the next calendar date (00:00-06:00).
    const dayPhase = (startTime: string) => (startTime < "06:00" ? 1 : 0);

    return Response.json({
      date,
      rooms: activeRooms.map((room) => ({
        id: room.id,
        name: room.name,
        bookings: (byRoom.get(room.id) ?? []).sort(
          (a, b) =>
            dayPhase(a.startTime) - dayPhase(b.startTime) ||
            a.startTime.localeCompare(b.startTime)
        ),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
