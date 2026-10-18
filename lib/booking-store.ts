import type { BookingSlotRef } from "./booking-engine.ts";
import { runIdempotentBatch, type IdempotencyRequest } from "./idempotency.ts";

export interface BookingInsert {
  bookingRef: string;
  userId: number | null;
  guestStudentName: string | null;
  guestStudentId: string | null;
  roomId: number;
  date: string;
  endDate?: string | null;
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

export function normalizeRequiredSlotRefs(
  booking: Pick<BookingInsert, "date">,
  requiredSlots: string[] | BookingSlotRef[],
): BookingSlotRef[] {
  return requiredSlots.map((slot) => typeof slot === "string" ? { date: booking.date, startTime: slot } : slot);
}

async function supportsBookingClaims(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'booking_claims' LIMIT 1").first<{ present: number }>();
  return Boolean(row?.present);
}

async function supportsBookingPolicy(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS present FROM pragma_table_info('bookings') WHERE name = 'policy_version' LIMIT 1").first<{ present: number }>();
  return Boolean(row?.present);
}

async function supportsBookingEndDate(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS present FROM pragma_table_info('bookings') WHERE name = 'end_date' LIMIT 1").first<{ present: number }>();
  return Boolean(row?.present);
}

function slotPredicate(alias: string, refs: BookingSlotRef[]): { sql: string; bindings: string[] } {
  return {
    sql: refs.map(() => `(${alias}.date = ? AND ${alias}.start_time = ?)`).join(" OR "),
    bindings: refs.flatMap((ref) => [ref.date, ref.startTime]),
  };
}

async function reservationStatements(
  db: D1Database,
  booking: BookingInsert,
  requiredSlots: string[] | BookingSlotRef[],
): Promise<{ statements: D1PreparedStatement[]; hasPolicy: boolean; hasEndDate: boolean }> {
  const refs = normalizeRequiredSlotRefs(booking, requiredSlots);
  const hasClaims = await supportsBookingClaims(db);
  const hasPolicy = await supportsBookingPolicy(db);
  const hasEndDate = await supportsBookingEndDate(db);
  const slot = slotPredicate("slot", refs);
  const candidate = slotPredicate("candidate", refs);
  const selected = slotPredicate("s", refs);
  const policyColumns = hasPolicy ? ", policy_version" : "";
  const policyValue = hasPolicy ? ", ?" : "";
  const endDateColumns = hasEndDate ? ", end_date" : "";
  const endDateValue = hasEndDate ? ", ?" : "";
  const policySelect = hasPolicy ? ", policy_version AS policyVersion" : "";
  const endDateSelect = hasEndDate ? ", end_date AS endDate" : "";
  const claimAvailability = hasClaims ? "AND NOT EXISTS (SELECT 1 FROM booking_claims occupied WHERE occupied.time_slot_id = slot.id)" : "";

  const bookingInsert = db.prepare(`
      INSERT INTO bookings
        (booking_ref, user_id, guest_student_name, guest_student_id,
          room_id, date, start_time, end_time, duration_minutes${endDateColumns}${policyColumns}, status)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?${endDateValue}${policyValue}, 'confirmed'
       WHERE (SELECT COUNT(DISTINCT slot.date || ':' || slot.start_time) FROM time_slots slot
         WHERE slot.room_id = ? AND (${slot.sql})
           AND slot.status = 'available'
           ${claimAvailability}) = ?
      RETURNING id, booking_ref AS bookingRef, user_id AS userId,
        guest_student_name AS guestStudentName, guest_student_id AS guestStudentId,
        room_id AS roomId, date${endDateSelect}, start_time AS startTime, end_time AS endTime,
         duration_minutes AS durationMinutes${policySelect}, status, created_at AS createdAt
    `).bind(
      booking.bookingRef, booking.userId, booking.guestStudentName,
      booking.guestStudentId, booking.roomId, booking.date, booking.startTime,
      booking.endTime, booking.durationMinutes,
      ...(hasEndDate ? [booking.endDate ?? booking.date] : []),
      ...(hasPolicy ? [booking.policyVersion ?? null] : []),
      booking.roomId, ...slot.bindings, refs.length,
    );

  const claimInsert = hasClaims ? db.prepare(`
      INSERT INTO booking_claims (time_slot_id, booking_id)
      SELECT s.id, b.id FROM bookings b JOIN time_slots s ON s.room_id = b.room_id
       WHERE b.booking_ref = ? AND (${selected.sql})
         AND s.status = 'available'
         AND NOT EXISTS (SELECT 1 FROM booking_claims existing WHERE existing.time_slot_id = s.id)
         AND (SELECT COUNT(DISTINCT candidate.date || ':' || candidate.start_time) FROM time_slots candidate
              WHERE candidate.room_id = b.room_id AND (${candidate.sql})
                AND candidate.status = 'available'
                AND NOT EXISTS (SELECT 1 FROM booking_claims occupied WHERE occupied.time_slot_id = candidate.id)) = ?
         AND changes() = 1
    `).bind(booking.bookingRef, ...selected.bindings, ...candidate.bindings, refs.length) : null;

  const claimLink = hasClaims
    ? "AND EXISTS (SELECT 1 FROM booking_claims c WHERE c.time_slot_id = s.id AND c.booking_id = b.id)"
    : "";
  const bookingSlotInsert = db.prepare(`
     INSERT INTO booking_slots (booking_id, time_slot_id)
      SELECT b.id, s.id FROM bookings b JOIN time_slots s ON s.room_id = b.room_id
       WHERE b.booking_ref = ? AND (${selected.sql})
         AND s.status = 'available'
         ${claimLink}
         AND s.id = (
           SELECT MIN(candidate.id) FROM time_slots candidate
           WHERE candidate.room_id = b.room_id
             AND candidate.date = s.date
             AND candidate.start_time = s.start_time
             AND candidate.status = 'available'
         )
         AND changes() ${hasClaims ? "> 0" : "= 1"}
   `).bind(booking.bookingRef, ...selected.bindings);

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
  return { statements, hasPolicy, hasEndDate };
}

/** Availability checks and all slot/claim writes commit in one D1 batch. */
export async function reserveSlots(
  db: D1Database,
  booking: BookingInsert,
  requiredSlots: string[] | BookingSlotRef[],
): Promise<StoredBooking | null> {
  const { statements } = await reservationStatements(db, booking, requiredSlots);
  const [result] = await db.batch<StoredBooking>(statements);
  return result.results[0] ?? null;
}

/** Persist the exact creation response in the same transaction as the slots. */
export async function reserveSlotsIdempotently(
  db: D1Database,
  booking: BookingInsert,
  requiredSlots: string[] | BookingSlotRef[],
  request: IdempotencyRequest,
  roomName: string,
): Promise<Response | null> {
  const { statements, hasPolicy, hasEndDate } = await reservationStatements(db, booking, requiredSlots);
  const endDateJson = hasEndDate ? "'endDate', end_date," : "";
  return runIdempotentBatch(db, request, [statements[0]], {
    sql: `SELECT json_object('booking', json_object(
      'id', id, 'bookingRef', booking_ref, 'roomId', room_id, 'roomName', ?,
      'date', date, ${endDateJson}'startTime', start_time, 'endTime', end_time,
      'durationMinutes', duration_minutes, ${hasPolicy ? "'policyVersion', policy_version," : ""}
      'guestStudentName', guest_student_name, 'status', status, 'createdAt', created_at
    )) AS response_body FROM bookings WHERE booking_ref = ? AND changes() = 1`,
    bindings: [roomName, booking.bookingRef],
  }, statements.slice(1));
}

export function isBookingReferenceConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /unique constraint failed: bookings\.booking_ref/i.test(error.message) || isBookingReferenceConflict(error.cause);
}

export function isBookingClaimConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /unique constraint failed: booking_claims\.time_slot_id/i.test(error.message) || isBookingClaimConflict(error.cause);
}

/** Release only slots with no remaining confirmed owner, in the same D1 batch. */
export async function cancelStoredBooking(db: D1Database, bookingId: number): Promise<void> {
  if (await supportsBookingClaims(db)) {
    await db.batch([
      db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'").bind(bookingId),
      db.prepare("DELETE FROM booking_claims WHERE booking_id = ?").bind(bookingId),
      db.prepare(`
        UPDATE time_slots SET status = 'available'
        WHERE status = 'booked' AND id IN (SELECT time_slot_id FROM booking_slots WHERE booking_id = ?)
          AND NOT EXISTS (SELECT 1 FROM booking_claims WHERE booking_claims.time_slot_id = time_slots.id)
          AND NOT EXISTS (SELECT 1 FROM booking_slots bs JOIN bookings b ON bs.booking_id = b.id
            WHERE bs.time_slot_id = time_slots.id AND b.status = 'confirmed')
      `).bind(bookingId),
    ]);
    return;
  }
  await db.batch([
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'").bind(bookingId),
    db.prepare(`UPDATE time_slots SET status = 'available' WHERE status = 'booked'
      AND id IN (SELECT time_slot_id FROM booking_slots WHERE booking_id = ?)
      AND NOT EXISTS (SELECT 1 FROM booking_slots bs JOIN bookings b ON bs.booking_id = b.id
        WHERE bs.time_slot_id = time_slots.id AND b.status = 'confirmed')`).bind(bookingId),
  ]);
}

/** Reconcile elapsed reservations atomically, including their active claims. */
export async function reconcileElapsedBookings(db: D1Database, bookingIds: number[]): Promise<void> {
  if (!bookingIds.length) return;
  const placeholders = bookingIds.map(() => "?").join(", ");
  const hasClaims = await supportsBookingClaims(db);
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE bookings SET status = 'completed' WHERE status = 'confirmed' AND id IN (${placeholders})`).bind(...bookingIds),
  ];
  if (hasClaims) statements.push(db.prepare(`DELETE FROM booking_claims WHERE booking_id IN (${placeholders})`).bind(...bookingIds));
  statements.push(db.prepare(`UPDATE time_slots SET status = 'available'
    WHERE status = 'booked' AND NOT EXISTS (SELECT 1 FROM booking_claims c WHERE c.time_slot_id = time_slots.id)
      AND NOT EXISTS (SELECT 1 FROM booking_slots bs JOIN bookings b ON bs.booking_id = b.id
        WHERE bs.time_slot_id = time_slots.id AND b.status = 'confirmed')`));
  await db.batch(statements);
}
