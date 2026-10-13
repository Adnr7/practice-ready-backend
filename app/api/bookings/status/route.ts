import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, rooms } from "@/db/schema";
import { deriveBookingPhase } from "@/lib/booking-engine";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ref = (searchParams.get("ref") ?? "").trim();

    if (!/^PR-\d{4}-\d{4}$/.test(ref)) {
      return Response.json(
        { error: "Invalid booking reference." },
        { status: 400 }
      );
    }

    const db = getDb();
    const [booking] = await db
      .select({
        bookingRef: bookings.bookingRef,
        guestStudentName: bookings.guestStudentName,
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

    const phase = deriveBookingPhase(
      booking.date,
      booking.startTime,
      booking.endTime,
      booking.status
    );

    return Response.json({
      booking: {
        bookingRef: booking.bookingRef,
        roomName: booking.roomName,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        status: booking.status,
        guestStudentName: booking.guestStudentName,
      },
      phase,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
