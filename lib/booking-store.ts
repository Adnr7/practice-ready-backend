import { runIdempotentBatch, type IdempotencyRequest } from "./idempotency.ts";

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
  policyVersion?: string | null;
}

export interface StoredBooking extends BookingInsert {
  id: number;
  status: "confirmed";
  createdAt: string;
}

async function supportsBookingClaims(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'booking_claims' LIMIT 1")
    .first<{ present: number }>();
  return Boolean(row?.present);
}

async function supportsBookingPolicy(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS present FROM pragma_table_info('bookings') WHERE name = 'policy_version' LIMIT 1").first<{ present: number }>();
  return Boolean(row?.present);
}

async function reservationStatements(
  db: D1Database,
  booking: BookingInsert,
  requiredSlots: string[],
): Promise<{ statements: D1PreparedStatement[]; hasPolicy: boolean }> {
  const hasClaims = await supportsBookingClaims(db);
  const hasPolicy = await supportsBookingPolicy(db);
  const placeholders = requiredSlots.map(() => "?").join(", ");
  const policyColumns = hasPolicy ? ", policy_version" : "";
  const policyValue = hasPolicy ? ", ?" : "";
  const policySelect = hasPolicy ? ", policy_version AS policyVersion" : "";
  const bookingInsert = db.prepare(`
      INSERT INTO bookings
        (booking_ref, user_id, guest_student_name, guest_student_id,
          room_id, date, start_time, end_time, duration_minutes${policyColumns}, status)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?${policyValue}, 'confirmed'
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
         duration_minutes AS durationMinutes${policySelect}, status, created_at AS createdAt
    `).bind(
      booking.bookingRef, booking.userId, booking.guestStudentName,
      booking.guestStudentId, booking.roomId, booking.date, booking.startTime,
       booking.endTime, booking.durationMinutes,
       ...(hasPolicy ? [booking.policyVersion ?? null] : []),
      booking.roomId, booking.date, ...requiredSlots, requiredSlots.length,
    );
  const claimInsert = hasClaims ? db.prepare(`
      INSERT INTO booking_claims (time_slot_id, booking_id)
      SELECT s.id, b.id FROM bookings b JOIN time_slots s
        ON s.room_id = b.room_id AND s.date = b.date
       WHERE b.booking_ref = ? AND s.start_time IN (${placeholders})
         AND s.status = 'available'
         AND NOT EXISTS (
           SELECT 1 FROM booking_claims existing
           WHERE existing.time_slot_id = s.id
         )
         AND (SELECT COUNT(DISTINCT candidate.start_time) FROM time_slots candidate
              WHERE candidate.room_id = b.room_id AND candidate.date = b.date
                AND candidate.start_time IN (${placeholders})
                AND candidate.status = 'available'
                AND NOT EXISTS (
                  SELECT 1 FROM booking_claims occupied
                  WHERE occupied.time_slot_id = candidate.id
                )) = ?
         AND changes() = 1
    `).bind(booking.bookingRef, ...requiredSlots, ...requiredSlots, requiredSlots.length) : null;
  const bookingSlotInsert = db.prepare(`
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
         AND changes() ${hasClaims ? "> 0" : "= 1"}
    `).bind(booking.bookingRef, ...requiredSlots);
  const statements = [
    bookingInsert,
    ...(claimInsert ? [claimInsert] : []),
    bookingSlotInsert,
    db.prepare(`
      UPDATE time_slots SET status = 'booked'
      WHERE changes() > 0 AND id IN (
        SELECT bs.time_slot_id FROM booking_slots bs
        JOIN bookings b ON b.id = bs.booking_id WHERE b.booking_ref = ?
      )
    `).bind(booking.bookingRef),
  ];
  return { statements, hasPolicy };
}

/** Availability checks and all slot/claim writes commit in one D1 batch. */
export async function reserveSlots(
  db: D1Database,
  booking: BookingInsert,
  requiredSlots: string[],
): Promise<StoredBooking | null> {
  const { statements } = await reservationStatements(db, booking, requiredSlots);
  const [result] = await db.batch<StoredBooking>(statements);
  return result.results[0] ?? null;
}

/** Persist the exact creation response in the same transaction as the slots. */
export async function reserveSlotsIdempotently(
  db: D1Database,
  booking: BookingInsert,
  requiredSlots: string[],
  request: IdempotencyRequest,
  roomName: string,
): Promise<Response | null> {
  const { statements, hasPolicy } = await reservationStatements(db, booking, requiredSlots);
  // Record immediately after the booking INSERT, so changes() identifies that
  // insert rather than a later slot write (or an existing colliding reference).
  // The strict replay INSERT preserves changes() = 1/0 for the claim/link chain.
  return runIdempotentBatch(db, request, [statements[0]], {
    sql: `SELECT json_object('booking', json_object(
      'id', id, 'bookingRef', booking_ref, 'roomId', room_id, 'roomName', ?,
      'date', date, 'startTime', start_time, 'endTime', end_time,
      'durationMinutes', duration_minutes, ${hasPolicy ? "'policyVersion', policy_version," : ""}
      'guestStudentName', guest_student_name, 'status', status, 'createdAt', created_at
    )) AS response_body FROM bookings WHERE booking_ref = ? AND changes() = 1`,
    bindings: [roomName, booking.bookingRef],
  }, statements.slice(1));
}

export function isBookingReferenceConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /unique constraint failed: bookings\.booking_ref/i.test(error.message) ||
    isBookingReferenceConflict(error.cause);
}

export function isBookingClaimConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /unique constraint failed: booking_claims\.time_slot_id/i.test(error.message) ||
    isBookingClaimConflict(error.cause);
}

/** Release only slots with no remaining confirmed owner, in the same D1 batch. */
export async function cancelStoredBooking(db: D1Database, bookingId: number): Promise<void> {
  if (await supportsBookingClaims(db)) {
    await db.batch([
      db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'").bind(bookingId),
      db.prepare("DELETE FROM booking_claims WHERE booking_id = ?").bind(bookingId),
      db.prepare(`
        UPDATE time_slots SET status = 'available'
        WHERE status = 'booked'
          AND id IN (SELECT time_slot_id FROM booking_slots WHERE booking_id = ?)
          AND NOT EXISTS (SELECT 1 FROM booking_claims WHERE booking_claims.time_slot_id = time_slots.id)
          AND NOT EXISTS (
            SELECT 1 FROM booking_slots bs JOIN bookings b ON bs.booking_id = b.id
            WHERE bs.time_slot_id = time_slots.id AND b.status = 'confirmed'
          )
      `).bind(bookingId),
    ]);
    return;
  }
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
