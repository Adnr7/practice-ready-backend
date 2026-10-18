import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { bookings, rooms } from "@/db/schema";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { deriveBookingPhase, getInstitutionNow } from "@/lib/booking-engine";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const ref = (searchParams.get("ref") ?? "").trim();

    if (!/^PR-\d{4}-\d{4}$/.test(ref)) {
      return Response.json(
        { error: "Invalid booking reference." },
        { status: 400 }
      );
    }

    const db = getDb();
    const hasEndDate = Boolean((await db.$client.prepare("SELECT 1 AS present FROM pragma_table_info('bookings') WHERE name = 'end_date' LIMIT 1").first<{ present: number }>())?.present);
    const [booking] = await db
      .select({
        userId: bookings.userId,
        bookingRef: bookings.bookingRef,
        date: bookings.date,
        startTime: bookings.startTime,
        endTime: bookings.endTime,
        status: bookings.status,
         roomName: rooms.name,
      })
      .from(bookings)
      .leftJoin(rooms, eq(bookings.roomId, rooms.id))
      .where(eq(bookings.bookingRef, ref))
      .limit(1);

    if (!booking) {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }
    if (session.role === "student" && booking.userId !== session.userId) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const endDateRow = hasEndDate
      ? await db.$client.prepare("SELECT end_date AS endDate FROM bookings WHERE booking_ref = ? LIMIT 1").bind(ref).first<{ endDate: string | null }>()
      : null;
    const endDate = endDateRow?.endDate ?? booking.date;

    const phase = deriveBookingPhase(
      booking.date,
      booking.startTime,
      booking.endTime,
      booking.status,
      getInstitutionNow(),
      endDate
    );

    return Response.json({
      booking: {
        bookingRef: booking.bookingRef,
        roomName: booking.roomName,
        date: booking.date,
        endDate,
        startTime: booking.startTime,
        endTime: booking.endTime,
        status: booking.status,
      },
      phase,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
