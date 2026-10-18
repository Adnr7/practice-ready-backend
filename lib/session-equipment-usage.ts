import { getBookingRow, type BookingActor, type BookingRow } from "./booking-lifecycle.ts";
import { deriveBookingPhase, getInstitutionNow } from "./booking-engine.ts";

export type SessionUsageRow = {
  id: number;
  bookingId: number;
  equipmentId: number;
  actorUserId: number;
  equipmentLabel: string;
  equipmentCode: string;
  observedLocationId: number | null;
  observedLocationName: string | null;
  observedCondition: string;
  observedStatus: string;
  observedAt: string;
  createdAt: string;
};

export class SessionUsageError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 422;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    status: 400 | 401 | 403 | 404 | 409 | 422 = 400,
    code = "SESSION_USAGE_ERROR",
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SessionUsageError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sessionUsageErrorResponse(error: unknown): Response {
  if (error instanceof SessionUsageError) {
    return Response.json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return Response.json({ error: message }, { status: 500 });
}

export function parseEquipmentUsageBody(body: unknown): { equipmentIds: number[] } {
  if (!body || typeof body !== "object" || !Array.isArray((body as { equipmentIds?: unknown }).equipmentIds)) {
    throw new SessionUsageError("equipmentIds must be an array of equipment IDs.", 400, "EQUIPMENT_IDS_REQUIRED");
  }
  const raw = (body as { equipmentIds: unknown[] }).equipmentIds;
  if (raw.length === 0 || raw.length > 100) {
    throw new SessionUsageError("Select between 1 and 100 equipment items.", 400, "EQUIPMENT_IDS_INVALID");
  }
  const equipmentIds = [...new Set(raw.map(Number))];
  if (equipmentIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new SessionUsageError("equipmentIds must contain positive integer IDs.", 400, "EQUIPMENT_IDS_INVALID");
  }
  return { equipmentIds };
}

function isStaff(actor: BookingActor): boolean {
  return actor.role === "technician" || actor.role === "admin";
}

async function getRows(db: D1Database, bookingId: number): Promise<SessionUsageRow[]> {
  const result = await db.prepare(`
    SELECT u.id,
      u.booking_id AS bookingId,
      u.equipment_id AS equipmentId,
      u.actor_user_id AS actorUserId,
      u.equipment_label AS equipmentLabel,
      u.equipment_code AS equipmentCode,
      u.observed_location_id AS observedLocationId,
      l.name AS observedLocationName,
      u.observed_condition AS observedCondition,
      u.observed_status AS observedStatus,
      u.observed_at AS observedAt,
      u.created_at AS createdAt
    FROM session_equipment_usage u
    LEFT JOIN locations l ON l.id = u.observed_location_id
    WHERE u.booking_id = ?
    ORDER BY u.id
  `).bind(bookingId).all<SessionUsageRow>();
  return result.results;
}

function assertUsageOwner(booking: BookingRow, actor: BookingActor): void {
  if (isStaff(actor)) return;
  if (booking.userId !== actor.userId) {
    throw new SessionUsageError("Only the booking owner can log session equipment.", 403, "SESSION_USAGE_FORBIDDEN");
  }
}

function assertActiveBooking(booking: BookingRow): void {
  if (booking.status !== "confirmed" || booking.sessionEndedAt) {
    throw new SessionUsageError("Equipment can only be logged during an active reservation.", 409, "SESSION_USAGE_NOT_ACTIVE");
  }
  const phase = deriveBookingPhase(
    booking.date,
    booking.startTime,
    booking.endTime,
    booking.status,
    getInstitutionNow(),
    booking.sessionEndedAt,
    booking.endDate,
  );
  if (phase !== "in_progress") {
    throw new SessionUsageError("Equipment can only be logged during an active reservation.", 409, "SESSION_USAGE_NOT_ACTIVE");
  }
}

export async function listSessionEquipmentUsage(
  db: D1Database,
  bookingId: number,
  actor: BookingActor,
): Promise<SessionUsageRow[]> {
  const booking = await getBookingRow(db, bookingId);
  if (!booking) throw new SessionUsageError("Booking not found.", 404, "BOOKING_NOT_FOUND");
  assertUsageOwner(booking, actor);
  return getRows(db, bookingId);
}

export async function recordSessionEquipmentUsage(
  db: D1Database,
  input: { bookingId: number; actor: BookingActor; equipmentIds: number[] },
): Promise<{ usage: SessionUsageRow[]; replayed: boolean }> {
  const booking = await getBookingRow(db, input.bookingId);
  if (!booking) throw new SessionUsageError("Booking not found.", 404, "BOOKING_NOT_FOUND");
  if (!isStaff(input.actor)) assertUsageOwner(booking, input.actor);
  if (isStaff(input.actor)) {
    throw new SessionUsageError("Staff accounts can read usage but cannot submit a student session log.", 403, "SESSION_USAGE_STAFF_WRITE_FORBIDDEN");
  }
  assertActiveBooking(booking);

  const placeholders = input.equipmentIds.map(() => "?").join(", ");
  const eligible = await db.prepare(`
    SELECT e.id AS equipmentId,
      e.name AS equipmentLabel,
      e.equipment_id AS equipmentCode,
      e.current_location_id AS observedLocationId,
      e.condition AS observedCondition,
      e.status AS observedStatus
    FROM equipment e
    WHERE e.id IN (${placeholders})
      AND e.default_room_id = ?
      AND e.default_location_id IS NOT NULL
      AND e.current_location_id = e.default_location_id
      AND e.status = 'ready'
  `).bind(...input.equipmentIds, booking.roomId).all<{
    equipmentId: number;
    equipmentLabel: string;
    equipmentCode: string;
    observedLocationId: number | null;
    observedCondition: string;
    observedStatus: string;
  }>();
  const eligibleIds = new Set(eligible.results.map((item) => item.equipmentId));
  const ineligible = input.equipmentIds.filter((id) => !eligibleIds.has(id));
  if (ineligible.length > 0) {
    throw new SessionUsageError(
      "Only present, usable equipment assigned to this room can be logged.",
      422,
      "EQUIPMENT_NOT_ELIGIBLE",
      { equipmentIds: ineligible },
    );
  }

  const existing = await getRows(db, input.bookingId);
  if (existing.length > 0) {
    const existingIds = existing.map((item) => item.equipmentId).sort((a, b) => a - b);
    const requestedIds = [...input.equipmentIds].sort((a, b) => a - b);
    if (existingIds.length === requestedIds.length && existingIds.every((id, index) => id === requestedIds[index])) {
      return { usage: existing, replayed: true };
    }
    throw new SessionUsageError(
      "Equipment use was already submitted for this session and cannot be changed.",
      409,
      "SESSION_USAGE_ALREADY_SUBMITTED",
      { submittedEquipmentIds: existingIds },
    );
  }

  const observedAt = new Date().toISOString();
  try {
    await db.batch(eligible.results.map((item) => db.prepare(`
      INSERT INTO session_equipment_usage
        (booking_id, equipment_id, actor_user_id, equipment_label, equipment_code,
         observed_location_id, observed_condition, observed_status, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.bookingId, item.equipmentId, input.actor.userId, item.equipmentLabel, item.equipmentCode,
      item.observedLocationId, item.observedCondition, item.observedStatus, observedAt,
    )));
  } catch (error) {
    // A concurrent first submission may have won the unique booking/equipment
    // index. Treat an identical retry as idempotent, but never merge two sets.
    const afterRace = await getRows(db, input.bookingId);
    const requestedIds = [...input.equipmentIds].sort((a, b) => a - b);
    const existingIds = afterRace.map((item) => item.equipmentId).sort((a, b) => a - b);
    if (existingIds.length === requestedIds.length && existingIds.every((id, index) => id === requestedIds[index])) {
      return { usage: afterRace, replayed: true };
    }
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      throw new SessionUsageError("Another equipment-use submission won this session. Refresh and review the receipt.", 409, "SESSION_USAGE_RACE");
    }
    throw error;
  }
  return { usage: await getRows(db, input.bookingId), replayed: false };
}
