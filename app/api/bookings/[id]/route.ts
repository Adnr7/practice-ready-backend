import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, bookingSlots, timeSlots } from "@/db/schema";
import { getSessionFromRequest } from "@/lib/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);

    if (isNaN(id) || id <= 0) {
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
    const isGuestBooking = !booking.userId;

    if (!isOwner && !isStaff && !isGuestBooking) {
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

    // Retrieve linked time slots
    const linkedSlots = await db
      .select({ timeSlotId: bookingSlots.timeSlotId })
      .from(bookingSlots)
      .where(eq(bookingSlots.bookingId, id));

    const slotIds = linkedSlots.map((s) => s.timeSlotId);

    // Free time slots back to available
    if (slotIds.length > 0) {
      await db
        .update(timeSlots)
        .set({ status: "available" })
        .where(inArray(timeSlots.id, slotIds));
    }

    // Mark booking as cancelled
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, id));

    return Response.json({
      success: true,
      message: "Booking successfully cancelled and time slots have been released.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
