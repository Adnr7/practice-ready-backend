export interface BookingInsert {
  bookingRef: string;
  userId: number | null;
  guestStudentName: string | null;
  guestStudentId: string | null;
  roomId: number;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

export interface StoredBooking extends BookingInsert {
  id: number;
  status: "confirmed";
  createdAt: string;
}

/**
 * D1 supports atomic batch(), not interactive BEGIN/COMMIT transactions.
 * The availability check is part of the INSERT, so two concurrent requests
 * cannot both pass it before claiming the same slots. All three writes either
 * commit together or roll back together.
 */
export async function reserveSlots(
  db: D1Database,
  booking: BookingInsert,
  requiredSlots: string[],
): Promise<StoredBooking | null> {
  const placeholders = requiredSlots.map(() => "?").join(", ");
  const [result] = await db.batch<StoredBooking>([
    db.prepare(`
      INSERT INTO bookings
        (booking_ref, user_id, guest_student_name, guest_student_id,
         room_id, date, start_time, end_time, duration_minutes, status)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed'
       WHERE (SELECT COUNT(DISTINCT slot.start_time) FROM time_slots slot
         WHERE slot.room_id = ? AND slot.date = ? AND slot.start_time IN (${placeholders})
           AND slot.status = 'available'
           AND NOT EXISTS (
             SELECT 1 FROM time_slots occupied
             WHERE occupied.room_id = slot.room_id
               AND occupied.date = slot.date
               AND occupied.start_time = slot.start_time
               AND occupied.status <> 'available'
           )) = ?
      RETURNING id, booking_ref AS bookingRef, user_id AS userId,
        guest_student_name AS guestStudentName, guest_student_id AS guestStudentId,
        room_id AS roomId, date, start_time AS startTime, end_time AS endTime,
        duration_minutes AS durationMinutes, status, created_at AS createdAt
    `).bind(
      booking.bookingRef, booking.userId, booking.guestStudentName,
      booking.guestStudentId, booking.roomId, booking.date, booking.startTime,
      booking.endTime, booking.durationMinutes,
      booking.roomId, booking.date, ...requiredSlots, requiredSlots.length,
    ),
    db.prepare(`
     INSERT INTO booking_slots (booking_id, time_slot_id)
     SELECT b.id, s.id FROM bookings b JOIN time_slots s
       ON s.room_id = b.room_id AND s.date = b.date
      WHERE b.booking_ref = ? AND s.start_time IN (${placeholders})
        AND s.status = 'available'
        AND NOT EXISTS (
          SELECT 1 FROM time_slots occupied
          WHERE occupied.room_id = s.room_id
            AND occupied.date = s.date
            AND occupied.start_time = s.start_time
            AND occupied.status <> 'available'
        )
        AND s.id = (
          SELECT MIN(candidate.id) FROM time_slots candidate
          WHERE candidate.room_id = b.room_id
            AND candidate.date = b.date
            AND candidate.start_time = s.start_time
            AND candidate.status = 'available'
            AND NOT EXISTS (
              SELECT 1 FROM time_slots occupied
              WHERE occupied.room_id = candidate.room_id
                AND occupied.date = candidate.date
                AND occupied.start_time = candidate.start_time
                AND occupied.status <> 'available'
            )
        )
        AND changes() = 1
    `).bind(booking.bookingRef, ...requiredSlots),
    db.prepare(`
      UPDATE time_slots SET status = 'booked'
      WHERE changes() > 0 AND id IN (
        SELECT bs.time_slot_id FROM booking_slots bs
        JOIN bookings b ON b.id = bs.booking_id WHERE b.booking_ref = ?
      )
    `).bind(booking.bookingRef),
  ]);
  return result.results[0] ?? null;
}

export function isBookingReferenceConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /unique constraint failed: bookings\.booking_ref/i.test(error.message) ||
    isBookingReferenceConflict(error.cause);
}

/** Release only slots with no remaining confirmed owner, in the same D1 batch. */
export async function cancelStoredBooking(db: D1Database, bookingId: number): Promise<void> {
  await db.batch([
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'").bind(bookingId),
    db.prepare(`
      UPDATE time_slots SET status = 'available'
      WHERE status = 'booked'
        AND id IN (SELECT time_slot_id FROM booking_slots WHERE booking_id = ?)
        AND NOT EXISTS (
          SELECT 1 FROM booking_slots bs JOIN bookings b ON bs.booking_id = b.id
          WHERE bs.time_slot_id = time_slots.id AND b.status = 'confirmed'
        )
    `).bind(bookingId),
  ]);
}
