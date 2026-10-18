import {
  deriveBookingPhase,
  getInstitutionNow,
  isStartInPast,
  validateBookingRequest,
  type BookingSlotRef,
  type BookingPhase,
} from "./booking-engine.ts";
import { getBookingPolicy, getCurrentBookingPolicy } from "./booking-policy.ts";
import { cancelStoredBooking } from "./booking-store.ts";
import { operationalConflictResponse } from "./operational-conflicts.ts";
import { BOOKABLE_ROOM_CODES } from "./seed-data.ts";

export type BookingActor = {
  userId: number;
  role: "student" | "technician" | "admin";
};

export type BookingRow = {
  id: number;
  bookingRef: string;
  userId: number | null;
  guestStudentName: string | null;
  guestStudentId: string | null;
  roomId: number;
  roomName: string;
  date: string;
  endDate: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  policyVersion: string | null;
  status: "confirmed" | "cancelled" | "completed";
  version: number;
  sessionEndedAt: string | null;
  cancelledAt: string | null;
  cancelledByUserId: number | null;
  cancellationReason: string | null;
  createdAt: string;
};

export type BookingView = BookingRow & { phase: BookingPhase };

export class BookingLifecycleError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    status: 400 | 401 | 403 | 404 | 409 | 422 | 500 = 400,
    code = "BOOKING_LIFECYCLE_ERROR",
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BookingLifecycleError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function bookingErrorResponse(error: unknown): Response {
  const conflict = operationalConflictResponse(error);
  if (conflict) return conflict;
  if (error instanceof BookingLifecycleError) {
    return Response.json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return Response.json({ error: message }, { status: 500 });
}

export function parseBookingId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BookingLifecycleError("Booking ID must be a positive integer.", 400, "BOOKING_ID_INVALID");
  }
  return id;
}

export function parseVersion(value: unknown): number {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new BookingLifecycleError("A positive booking version is required.", 400, "BOOKING_VERSION_REQUIRED");
  }
  return version;
}

function isStaff(actor: BookingActor): boolean {
  return actor.role === "technician" || actor.role === "admin";
}

function phaseFor(row: Pick<BookingRow, "date" | "endDate" | "startTime" | "endTime" | "status" | "sessionEndedAt">): BookingPhase {
  return deriveBookingPhase(row.date, row.startTime, row.endTime, row.status, getInstitutionNow(), row.sessionEndedAt, row.endDate);
}

function toView(row: BookingRow): BookingView {
  return { ...row, phase: phaseFor(row) };
}

export async function getBookingRow(db: D1Database, bookingId: number): Promise<BookingRow | null> {
  const hasEndDate = await hasBookingEndDate(db);
  const hasPolicyVersion = Boolean((await db.prepare("SELECT 1 AS present FROM pragma_table_info('bookings') WHERE name = 'policy_version' LIMIT 1").first<{ present: number }>())?.present);
  return db.prepare(`
    SELECT b.id,
      b.booking_ref AS bookingRef,
      b.user_id AS userId,
      b.guest_student_name AS guestStudentName,
      b.guest_student_id AS guestStudentId,
      b.room_id AS roomId,
      r.name AS roomName,
      b.date,
      ${hasEndDate ? "b.end_date AS endDate," : ""}
      b.start_time AS startTime,
      b.end_time AS endTime,
      b.duration_minutes AS durationMinutes,
       ${hasPolicyVersion ? "b.policy_version" : "NULL"} AS policyVersion,
      b.status,
      b.version,
      b.session_ended_at AS sessionEndedAt,
      b.cancelled_at AS cancelledAt,
      b.cancelled_by_user_id AS cancelledByUserId,
      b.cancellation_reason AS cancellationReason,
      b.created_at AS createdAt
    FROM bookings b
    JOIN rooms r ON r.id = b.room_id
    WHERE b.id = ?
    LIMIT 1
  `).bind(bookingId).first<BookingRow>().then((row) => row ? { ...row, endDate: row.endDate ?? row.date } : null);
}

export function assertBookingAccess(row: BookingRow, actor: BookingActor): void {
  if (isStaff(actor)) return;
  if (row.userId !== actor.userId) {
    throw new BookingLifecycleError("You do not have access to this booking.", 403, "BOOKING_FORBIDDEN");
  }
}

function assertRescheduleAccess(row: BookingRow, actor: BookingActor, reason?: string): void {
  assertBookingAccess(row, actor);
  if (isStaff(actor) && (!reason || reason.trim().length < 5)) {
    throw new BookingLifecycleError("Staff rescheduling requires a reason of at least 5 characters.", 400, "BOOKING_REASON_REQUIRED");
  }
  if (!isStaff(actor) && row.userId !== actor.userId) {
    throw new BookingLifecycleError("Only the booking owner can reschedule this booking.", 403, "BOOKING_OWNER_REQUIRED");
  }
}

async function hasLifecycleTables(db: D1Database): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'booking_claims' LIMIT 1",
  ).first<{ present: number }>();
  return Boolean(row?.present);
}

async function hasBookingEndDate(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS present FROM pragma_table_info('bookings') WHERE name = 'end_date' LIMIT 1").first<{ present: number }>();
  return Boolean(row?.present);
}

function slotPredicate(alias: string, refs: BookingSlotRef[]): { sql: string; bindings: string[] } {
  return {
    sql: refs.map(() => `(${alias}.date = ? AND ${alias}.start_time = ?)`).join(" OR "),
    bindings: refs.flatMap((ref) => [ref.date, ref.startTime]),
  };
}

async function targetSlotCountForRefs(
  db: D1Database,
  roomId: number,
  requiredSlots: BookingSlotRef[],
  bookingId: number,
): Promise<{ count: number; conflictingSlots: string[] }> {
  const slots = slotPredicate("s", requiredSlots);
  const rows = await db.prepare(`
    SELECT s.start_time AS startTime,
      CASE WHEN s.status = 'available' OR own.time_slot_id IS NOT NULL THEN 1 ELSE 0 END AS eligible
    FROM time_slots s
    LEFT JOIN booking_claims own ON own.time_slot_id = s.id AND own.booking_id = ?
    LEFT JOIN booking_claims other ON other.time_slot_id = s.id AND other.booking_id <> ?
    WHERE s.room_id = ? AND (${slots.sql})
      AND other.time_slot_id IS NULL
  `).bind(bookingId, bookingId, roomId, ...slots.bindings).all<{ startTime: string; eligible: number }>();
  const byStart = new Map(rows.results.map((row) => [`${row.startTime}`, row]));
  const conflictingSlots = requiredSlots.filter((slot) => !byStart.get(slot.startTime)?.eligible).map((slot) => slot.startTime);
  return { count: requiredSlots.length - conflictingSlots.length, conflictingSlots };
}

export async function getBookingView(db: D1Database, bookingId: number): Promise<BookingView | null> {
  const row = await getBookingRow(db, bookingId);
  return row ? toView(row) : null;
}

export async function rescheduleBooking(
  db: D1Database,
  input: {
    bookingId: number;
    actor: BookingActor;
    roomId: number;
    date: string;
    endDate?: string;
    startTime: string;
    endTime: string;
    version: number;
    reason?: string;
  },
): Promise<BookingView> {
  if (!(await hasLifecycleTables(db))) {
    throw new BookingLifecycleError("Reservation lifecycle migration is required before rescheduling.", 500, "LIFECYCLE_MIGRATION_REQUIRED");
  }

  const current = await getBookingRow(db, input.bookingId);
  if (!current) throw new BookingLifecycleError("Booking not found.", 404, "BOOKING_NOT_FOUND");
  assertRescheduleAccess(current, input.actor, input.reason);
  if (current.status !== "confirmed" || current.sessionEndedAt || isStartInPast(current.date, current.startTime, getInstitutionNow())) {
    throw new BookingLifecycleError("Only upcoming reservations can be rescheduled.", 409, "BOOKING_NOT_RESCHEDULABLE");
  }
  if (current.version !== input.version) {
    throw new BookingLifecycleError("This reservation changed. Refresh it before rescheduling.", 409, "BOOKING_VERSION_CONFLICT");
  }

  const policy = await getCurrentBookingPolicy(db);
  const validation = validateBookingRequest({ date: input.date, endDate: input.endDate, startTime: input.startTime, endTime: input.endTime }, getInstitutionNow(), policy);
  if (!validation.valid || !validation.requiredSlots || !validation.durationMinutes) {
    throw new BookingLifecycleError(validation.error ?? "Invalid reschedule window.", 400, "BOOKING_WINDOW_INVALID");
  }

  const room = await db.prepare("SELECT id, code FROM rooms WHERE id = ? AND is_active = 1 LIMIT 1").bind(input.roomId).first<{ id: number; code: string }>();
  if (!room || !BOOKABLE_ROOM_CODES.includes(room.code as typeof BOOKABLE_ROOM_CODES[number])) throw new BookingLifecycleError("Selected room does not exist or is inactive.", 404, "ROOM_NOT_FOUND");

  const targetRefs = validation.requiredSlotRefs ?? validation.requiredSlots.map((startTime) => ({ date: input.date, startTime }));
  const target = await targetSlotCountForRefs(db, input.roomId, targetRefs, input.bookingId);
  if (target.count !== validation.requiredSlots.length) {
    throw new BookingLifecycleError(
      "One or more selected slots are no longer available.",
      409,
      "BOOKING_CONFLICT",
      { conflictingSlots: target.conflictingSlots },
    );
  }

  const token = crypto.randomUUID();
  const targetPredicate = slotPredicate("s", targetRefs);
  const candidatePredicate = slotPredicate("s", targetRefs);
  const oldTargetPredicate = slotPredicate("time_slots", targetRefs);
  const hasEndDate = await hasBookingEndDate(db);
  const endDateUpdate = hasEndDate ? "end_date = ?, " : "";
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`
      UPDATE bookings
      SET version = version + 1, mutation_token = ?
      WHERE id = ? AND version = ? AND status = 'confirmed' AND mutation_token IS NULL
        AND (SELECT COUNT(DISTINCT s.start_time)
             FROM time_slots s
             LEFT JOIN booking_claims own ON own.time_slot_id = s.id AND own.booking_id = ?
             LEFT JOIN booking_claims other ON other.time_slot_id = s.id AND other.booking_id <> ?
             WHERE s.room_id = ? AND (${targetPredicate.sql})
               AND other.time_slot_id IS NULL
               AND (s.status = 'available' OR own.time_slot_id IS NOT NULL)) = ?
    `).bind(
      token, input.bookingId, input.version, input.bookingId, input.bookingId,
      input.roomId, ...targetPredicate.bindings, validation.requiredSlots.length,
    ),
    db.prepare(`
      INSERT OR IGNORE INTO booking_claims (time_slot_id, booking_id)
      SELECT s.id, ? FROM time_slots s
       WHERE s.room_id = ? AND (${candidatePredicate.sql})
        AND s.status = 'available'
        AND NOT EXISTS (SELECT 1 FROM booking_claims c WHERE c.time_slot_id = s.id)
        AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = ? AND b.mutation_token = ?)
    `).bind(input.bookingId, input.roomId, ...candidatePredicate.bindings, input.bookingId, token),
    db.prepare(`
      DELETE FROM booking_claims
      WHERE booking_id = ?
         AND time_slot_id NOT IN (
           SELECT id FROM time_slots WHERE room_id = ? AND (${oldTargetPredicate.sql})
         )
        AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = ? AND b.mutation_token = ?)
    `).bind(input.bookingId, input.roomId, ...oldTargetPredicate.bindings, input.bookingId, token),
    db.prepare(`
      INSERT OR IGNORE INTO booking_slots (booking_id, time_slot_id)
       SELECT ?, s.id FROM time_slots s
       WHERE s.room_id = ? AND (${targetPredicate.sql})
        AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = ? AND b.mutation_token = ?)
    `).bind(input.bookingId, input.roomId, ...targetPredicate.bindings, input.bookingId, token),
    db.prepare(`
      INSERT INTO booking_history
        (booking_id, actor_user_id, action, previous_room_id, previous_date, previous_start_time, previous_end_time,
         new_room_id, new_date, new_start_time, new_end_time, reason, created_at)
      SELECT ?, ?, 'rescheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.id = ? AND b.mutation_token = ?)
    `).bind(
      input.bookingId, input.actor.userId, current.roomId, current.date, current.startTime, current.endTime,
      input.roomId, input.date, input.startTime, input.endTime, input.reason?.trim() || null, now,
      input.bookingId, token,
    ),
    db.prepare(`
      UPDATE bookings
       SET room_id = ?, date = ?, ${endDateUpdate}start_time = ?, end_time = ?, duration_minutes = ?, policy_version = ?, mutation_token = NULL
       WHERE id = ? AND mutation_token = ?
      `).bind(...(hasEndDate ? [input.roomId, input.date, validation.endDate] : [input.roomId, input.date]), ...(hasEndDate ? [input.startTime, input.endTime] : [input.startTime, input.endTime]), validation.durationMinutes, policy.version, input.bookingId, token),
    db.prepare(`
      UPDATE time_slots SET status = 'booked'
      WHERE id IN (SELECT time_slot_id FROM booking_claims WHERE booking_id = ?)
    `).bind(input.bookingId),
    db.prepare(`
      UPDATE time_slots SET status = 'available'
      WHERE status = 'booked'
        AND NOT EXISTS (SELECT 1 FROM booking_claims c WHERE c.time_slot_id = time_slots.id)
    `),
  ]);

  const changed = Number((results[0] as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (changed !== 1) {
    const latest = await getBookingRow(db, input.bookingId);
    if (latest?.status === "cancelled") throw new BookingLifecycleError("The reservation was cancelled before it could be rescheduled.", 409, "BOOKING_STATE_CONFLICT");
    throw new BookingLifecycleError("This reservation changed. Refresh it before rescheduling.", 409, "BOOKING_VERSION_CONFLICT");
  }
  const updated = await getBookingView(db, input.bookingId);
  if (!updated) throw new BookingLifecycleError("Booking disappeared after rescheduling.", 500, "BOOKING_WRITE_FAILED");
  return updated;
}

export async function cancelBooking(
  db: D1Database,
  input: { bookingId: number; actor: BookingActor; reason?: string; version?: number },
): Promise<{ booking: BookingView; alreadyCancelled: boolean }> {
  const current = await getBookingRow(db, input.bookingId);
  if (!current) throw new BookingLifecycleError("Booking not found.", 404, "BOOKING_NOT_FOUND");
  assertBookingAccess(current, input.actor);

  if (current.status === "cancelled") return { booking: toView(current), alreadyCancelled: true };
  if (current.status !== "confirmed") {
    throw new BookingLifecycleError("This reservation can no longer be cancelled.", 409, "BOOKING_NOT_CANCELLABLE");
  }
  const campusNow = getInstitutionNow();
  if (isStartInPast(current.date, current.startTime, campusNow) && !isStaff(input.actor)) {
    throw new BookingLifecycleError("This reservation has already started and can no longer be cancelled.", 409, "BOOKING_CUTOFF");
  }
  if (!isStaff(input.actor)) {
    const policy = current.policyVersion
      ? ((await getBookingPolicy(db, current.policyVersion)) ?? (await getCurrentBookingPolicy(db)))
      : await getCurrentBookingPolicy(db);
    const [year, month, day] = current.date.split("-").map(Number);
    const [hours, minutes] = current.startTime.split(":").map(Number);
    const startEpoch = Date.UTC(year, month - 1, day, hours, minutes) - 330 * 60_000;
    if (startEpoch - Date.now() < policy.cancellationCutoffMinutes * 60_000) {
      throw new BookingLifecycleError("This reservation is within the cancellation cutoff window.", 409, "BOOKING_CUTOFF");
    }
  }
  if (isStaff(input.actor) && (!input.reason || input.reason.trim().length < 5)) {
    throw new BookingLifecycleError("Staff cancellation requires a reason of at least 5 characters.", 400, "BOOKING_REASON_REQUIRED");
  }

  if (!(await hasLifecycleTables(db))) {
    await cancelStoredBooking(db, input.bookingId);
    const legacy = await getBookingRow(db, input.bookingId);
    if (!legacy) throw new BookingLifecycleError("Booking disappeared after cancellation.", 500, "BOOKING_WRITE_FAILED");
    return { booking: toView(legacy), alreadyCancelled: false };
  }

  const expectedVersion = input.version ?? current.version;
  if (expectedVersion !== current.version) {
    throw new BookingLifecycleError("This reservation changed. Refresh it before cancelling.", 409, "BOOKING_VERSION_CONFLICT");
  }
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`
      UPDATE bookings
      SET status = 'cancelled', version = version + 1, mutation_token = ?, cancelled_at = ?,
          cancelled_by_user_id = ?, cancellation_reason = ?
      WHERE id = ? AND status = 'confirmed' AND version = ? AND mutation_token IS NULL
    `).bind(token, now, input.actor.userId, input.reason?.trim() || null, input.bookingId, expectedVersion),
    db.prepare(`
      DELETE FROM booking_claims
      WHERE booking_id = ? AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = ? AND b.mutation_token = ?)
    `).bind(input.bookingId, input.bookingId, token),
    db.prepare(`
      INSERT INTO booking_history
        (booking_id, actor_user_id, action, previous_room_id, previous_date, previous_start_time, previous_end_time, reason, created_at)
      SELECT ?, ?, 'cancelled', ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.id = ? AND b.mutation_token = ?)
    `).bind(
      input.bookingId, input.actor.userId, current.roomId, current.date, current.startTime, current.endTime,
      input.reason?.trim() || null, now, input.bookingId, token,
    ),
    db.prepare("UPDATE bookings SET mutation_token = NULL WHERE id = ? AND mutation_token = ?").bind(input.bookingId, token),
    db.prepare(`
      UPDATE time_slots SET status = 'available'
      WHERE status = 'booked'
        AND NOT EXISTS (SELECT 1 FROM booking_claims c WHERE c.time_slot_id = time_slots.id)
    `),
  ]);
  const changed = Number((results[0] as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (changed !== 1) {
    const latest = await getBookingRow(db, input.bookingId);
    if (latest?.status === "cancelled") return { booking: toView(latest), alreadyCancelled: true };
    throw new BookingLifecycleError("This reservation changed. Refresh it before cancelling.", 409, "BOOKING_VERSION_CONFLICT");
  }
  const updated = await getBookingView(db, input.bookingId);
  if (!updated) throw new BookingLifecycleError("Booking disappeared after cancellation.", 500, "BOOKING_WRITE_FAILED");
  return { booking: updated, alreadyCancelled: false };
}

export async function endActiveSession(
  db: D1Database,
  input: { bookingId: number; actor: BookingActor; reason?: string; version?: number },
): Promise<{ booking: BookingView; alreadyEnded: boolean }> {
  const current = await getBookingRow(db, input.bookingId);
  if (!current) throw new BookingLifecycleError("Booking not found.", 404, "BOOKING_NOT_FOUND");
  assertBookingAccess(current, input.actor);
  if (current.sessionEndedAt || current.status === "completed") return { booking: toView(current), alreadyEnded: true };
  if (current.status === "cancelled") throw new BookingLifecycleError("Cancelled reservations cannot have an active session.", 409, "BOOKING_CANCELLED");
  if (phaseFor(current) !== "in_progress") throw new BookingLifecycleError("Only an active reservation can be ended.", 409, "BOOKING_NOT_ACTIVE");
  if (isStaff(input.actor) && (!input.reason || input.reason.trim().length < 5)) {
    throw new BookingLifecycleError("Staff session ending requires a reason of at least 5 characters.", 400, "BOOKING_REASON_REQUIRED");
  }
  const expectedVersion = input.version ?? current.version;
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`
      UPDATE bookings
      SET status = 'completed', version = version + 1, mutation_token = ?, session_ended_at = ?
      WHERE id = ? AND status = 'confirmed' AND session_ended_at IS NULL AND version = ? AND mutation_token IS NULL
    `).bind(token, now, input.bookingId, expectedVersion),
    db.prepare(`
      DELETE FROM booking_claims
      WHERE booking_id = ? AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = ? AND b.mutation_token = ?)
    `).bind(input.bookingId, input.bookingId, token),
    db.prepare(`
      INSERT INTO booking_history
        (booking_id, actor_user_id, action, previous_room_id, previous_date, previous_start_time, previous_end_time, new_end_time, reason, created_at)
      SELECT ?, ?, 'session_ended', ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM bookings b WHERE b.id = ? AND b.mutation_token = ?)
    `).bind(
      input.bookingId, input.actor.userId, current.roomId, current.date, current.startTime, current.endTime,
      current.endTime, input.reason?.trim() || "Student ended the active session.", now, input.bookingId, token,
    ),
    db.prepare("UPDATE bookings SET mutation_token = NULL WHERE id = ? AND mutation_token = ?").bind(input.bookingId, token),
    db.prepare(`
      UPDATE time_slots SET status = 'available'
      WHERE status = 'booked'
        AND NOT EXISTS (SELECT 1 FROM booking_claims c WHERE c.time_slot_id = time_slots.id)
    `),
  ]);
  const changed = Number((results[0] as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (changed !== 1) {
    const latest = await getBookingRow(db, input.bookingId);
    if (latest?.sessionEndedAt || latest?.status === "completed") return { booking: toView(latest), alreadyEnded: true };
    throw new BookingLifecycleError("This reservation changed. Refresh it before ending the session.", 409, "BOOKING_VERSION_CONFLICT");
  }
  const updated = await getBookingView(db, input.bookingId);
  if (!updated) throw new BookingLifecycleError("Booking disappeared after ending the session.", 500, "BOOKING_WRITE_FAILED");
  return { booking: updated, alreadyEnded: false };
}
