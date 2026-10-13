import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings } from "@/db/schema";
import { cancelStoredBooking } from "@/lib/booking-store";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { getInstitutionNow, isStartInPast } from "@/lib/booking-engine";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const { id: idParam } = await params;
    const id = Number(idParam);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return Response.json(
        { error: "Booking ID must be a positive integer." },
        { status: 400 }
      );
    }

    const session = await getSessionFromRequest(request);
    const db = getDb();

    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, id))
      .limit(1);

    if (!booking) {
      return Response.json({ error: "Booking not found." }, { status: 404 });
    }

    // Verify ownership or staff permissions
    const isOwner = session && booking.userId === session.userId;
    const isStaff = session && (session.role === "admin" || session.role === "technician");
    if (!isOwner && !isStaff) {
      return Response.json(
        { error: "Forbidden: You do not have permission to cancel this booking." },
        { status: 403 }
      );
    }

    if (booking.status === "cancelled") {
      return Response.json(
        { message: "Booking is already cancelled." },
        { status: 200 }
      );
    }

    // Policy: reservations may only be cancelled before their start time.
    if (isStartInPast(booking.date, booking.startTime, getInstitutionNow())) {
      return Response.json(
        {
          error:
            "This reservation has already started and can no longer be cancelled.",
        },
        { status: 409 }
      );
    }

    await cancelStoredBooking(db.$client, id);

    return Response.json({
      success: true,
      message: "Booking successfully cancelled and time slots have been released.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
