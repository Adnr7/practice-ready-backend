import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { rooms } from "@/db/schema";
import { getInstitutionNow, isValidCalendarDate } from "@/lib/booking-engine";
import { BOOKABLE_ROOM_CODES } from "@/lib/seed-data";

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
      .select({ id: rooms.id, name: rooms.name, code: rooms.code })
      .from(rooms)
      .where(eq(rooms.isActive, true))
      .orderBy(asc(rooms.id));

    const bookableRooms = activeRooms.filter((room) => BOOKABLE_ROOM_CODES.includes(room.code as typeof BOOKABLE_ROOM_CODES[number]));

    const hasEndDate = Boolean((await db.$client.prepare("SELECT 1 AS present FROM pragma_table_info('bookings') WHERE name = 'end_date' LIMIT 1").first<{ present: number }>())?.present);
    const rows = await db.$client.prepare(`
      SELECT room_id AS roomId, booking_ref AS bookingRef,
        ${hasEndDate ? "end_date AS endDate," : "NULL AS endDate,"}
        start_time AS startTime, end_time AS endTime
      FROM bookings
      WHERE status = 'confirmed' AND ((date = ? AND start_time >= '06:00') OR (date = ? AND start_time < '06:00'))
      ORDER BY start_time
    `).bind(date, nextDateStr).all<{ roomId: number; bookingRef: string; endDate: string | null; startTime: string; endTime: string }>();

    const byRoom = new Map<
      number,
         { bookingRef: string; endDate: string | null; startTime: string; endTime: string }[]
    >();
    for (const row of rows.results) {
      const list = byRoom.get(row.roomId) ?? [];
      list.push({
        bookingRef: row.bookingRef,
        endDate: row.endDate,
        startTime: row.startTime,
        endTime: row.endTime,
      });
      byRoom.set(row.roomId, list);
    }

    // Operational-day order: daytime slots first (06:00-24:00), then the
    // late-night tail of the next calendar date (00:00-06:00).
    const dayPhase = (startTime: string) => (startTime < "06:00" ? 1 : 0);

    return Response.json({
      date,
      rooms: bookableRooms.map((room) => ({
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
