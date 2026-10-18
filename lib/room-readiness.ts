import type { BookingActor } from "./booking-lifecycle.ts";
import { operationalConflictResponse } from "./operational-conflicts.ts";

export type RoomReadinessState = "usable" | "restricted" | "closed" | "unknown";
export type RestrictionState = "allowed" | "restricted" | "unsupported" | "unknown";

export type RoomReadiness = {
  id: number;
  name: string;
  code: string;
  capacity: number;
  description: string;
  isActive: boolean;
  locationId: number | null;
  locationName: string | null;
  readinessState: RoomReadinessState;
  readinessNotes: string | null;
  readinessVerifiedAt: string | null;
  restrictions: Array<{
    id: number;
    activityKey: string;
    state: RestrictionState;
    explanation: string;
  }>;
  activeClosures: Array<{
    id: number;
    startsAt: string;
    endsAt: string;
    reason: string;
  }>;
};

export class RoomReadinessError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 422 | 500;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, status: 400 | 403 | 404 | 409 | 422 | 500 = 400, code = "ROOM_READINESS_ERROR", details?: Record<string, unknown>) {
    super(message);
    this.name = "RoomReadinessError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function roomReadinessErrorResponse(error: unknown): Response {
  const conflict = operationalConflictResponse(error);
  if (conflict) return conflict;
  if (error instanceof RoomReadinessError) {
    return Response.json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
}

export function requireStaff(actor: BookingActor): void {
  if (actor.role !== "technician" && actor.role !== "admin") {
    throw new RoomReadinessError("Only FTS technicians and administrators can change readiness data.", 403, "ROOM_READINESS_FORBIDDEN");
  }
}

export function parsePositiveId(value: string, label: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new RoomReadinessError(`${label} must be a positive integer.`, 400, "ID_INVALID");
  return id;
}

function parseIso(value: unknown, label: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new RoomReadinessError(`${label} must be a valid ISO timestamp.`, 400, "TIMESTAMP_INVALID");
  }
  return new Date(value).toISOString();
}

export async function getRoomReadiness(db: D1Database, roomId: number, now = new Date()): Promise<RoomReadiness | null> {
  const roomColumns = await db.prepare("SELECT name FROM pragma_table_info('rooms')").all<{ name: string }>();
  const columns = new Set(roomColumns.results.map((column) => column.name));
  const hasLocation = columns.has("location_id");
  const hasReadiness = columns.has("readiness_state");
  const room = await db.prepare(`
    SELECT r.id, r.name, r.code, r.capacity, r.description, r.is_active AS isActive,
      ${hasLocation ? "r.location_id" : "NULL"} AS locationId,
      ${hasLocation ? "l.name" : "NULL"} AS locationName,
      ${hasReadiness ? "r.readiness_state" : "'unknown'"} AS readinessState,
      ${hasReadiness ? "r.readiness_notes" : "NULL"} AS readinessNotes,
      ${hasReadiness ? "r.readiness_verified_at" : "NULL"} AS readinessVerifiedAt
    FROM rooms r ${hasLocation ? "LEFT JOIN locations l ON l.id = r.location_id" : ""}
    WHERE r.id = ? LIMIT 1
  `).bind(roomId).first<RoomReadiness>();
  if (!room) return null;
  const hasRestrictions = Boolean((await db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'room_restrictions' LIMIT 1").first<{ present: number }>())?.present);
  const hasClosures = Boolean((await db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'room_closures' LIMIT 1").first<{ present: number }>())?.present);
  const restrictions = hasRestrictions
    ? await db.prepare(`
      SELECT id, activity_key AS activityKey, state, explanation
      FROM room_restrictions WHERE room_id = ? AND is_active = 1 ORDER BY activity_key, id
    `).bind(roomId).all<RoomReadiness["restrictions"][number]>()
    : { results: [] as RoomReadiness["restrictions"] };
  const activeClosures = hasClosures
    ? await db.prepare(`
      SELECT id, starts_at AS startsAt, ends_at AS endsAt, reason
      FROM room_closures
      WHERE room_id = ? AND is_active = 1 AND ends_at > ?
      ORDER BY starts_at
    `).bind(roomId, now.toISOString()).all<RoomReadiness["activeClosures"][number]>()
    : { results: [] as RoomReadiness["activeClosures"] };
  return {
    ...room,
    isActive: Boolean(room.isActive),
    restrictions: restrictions.results,
    activeClosures: activeClosures.results,
  };
}

export async function updateRoomReadiness(
  db: D1Database,
  input: { roomId: number; actor: BookingActor; state?: RoomReadinessState; notes?: string | null; restriction?: { activityKey: string; state: RestrictionState; explanation: string } },
): Promise<RoomReadiness> {
  requireStaff(input.actor);
  const current = await getRoomReadiness(db, input.roomId);
  if (!current) throw new RoomReadinessError("Room not found.", 404, "ROOM_NOT_FOUND");
  if (!input.state && input.notes === undefined && !input.restriction) {
    throw new RoomReadinessError("Provide a room state, notes, or restriction update.", 400, "ROOM_UPDATE_EMPTY");
  }
  if (input.state !== undefined && !["usable", "restricted", "closed", "unknown"].includes(input.state)) {
    throw new RoomReadinessError("Invalid room readiness state.", 400, "ROOM_STATE_INVALID");
  }
  if (input.notes !== undefined && input.notes !== null && (typeof input.notes !== "string" || input.notes.length > 4000)) {
    throw new RoomReadinessError("Room notes must be at most 4,000 characters.", 400, "ROOM_NOTES_INVALID");
  }
  const statements: D1PreparedStatement[] = [];
  if (input.restriction) {
    if (!["allowed", "restricted", "unsupported", "unknown"].includes(input.restriction.state)) {
      throw new RoomReadinessError("Invalid activity restriction state.", 400, "RESTRICTION_INVALID");
    }
    if (!input.restriction.activityKey.trim() || input.restriction.explanation.trim().length < 3) {
      throw new RoomReadinessError("A restriction activity and explanation are required.", 400, "RESTRICTION_INVALID");
    }
    statements.push(
      db.prepare("UPDATE room_restrictions SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE room_id = ? AND activity_key = ? AND is_active = 1").bind(input.roomId, input.restriction.activityKey.trim()),
      db.prepare(`
      INSERT INTO room_restrictions (room_id, activity_key, state, explanation, is_active, created_by_user_id, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
      `).bind(input.roomId, input.restriction.activityKey.trim(), input.restriction.state, input.restriction.explanation.trim(), input.actor.userId),
    );
  }
  if (input.state || input.notes !== undefined) {
    statements.push(db.prepare(`
      UPDATE rooms SET readiness_state = COALESCE(?, readiness_state), readiness_notes = ?, readiness_verified_at = ?, readiness_verified_by_user_id = ?
      WHERE id = ?
    `).bind(input.state ?? null, input.notes === undefined ? current.readinessNotes : input.notes, new Date().toISOString(), input.actor.userId, input.roomId));
  }
  statements.push(db.prepare("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,reason,details) VALUES (?,'readiness_updated','room',?,?,?)")
    .bind(input.actor.userId, String(input.roomId), input.notes ?? input.restriction?.explanation ?? "Staff readiness verification", JSON.stringify({ state: input.state, restriction: input.restriction })));
  await db.batch(statements);
  const updated = await getRoomReadiness(db, input.roomId);
  if (!updated) throw new RoomReadinessError("Room disappeared after update.", 500, "ROOM_WRITE_FAILED");
  return updated;
}

export function bookingInstant(date: string, time: string, isEnd = false, endDate?: string | null): number {
  const minutes = isEnd && time === "00:00" && (!endDate || endDate === date) ? 1440 : Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const [year, month, day] = date.split("-").map(Number);
  const endDay = isEnd && endDate && endDate !== date ? endDate : date;
  const [endYear, endMonth, endDayOfMonth] = endDay.split("-").map(Number);
  return Date.UTC(isEnd ? endYear : year, isEnd ? endMonth - 1 : month - 1, isEnd ? endDayOfMonth : day, 0, minutes) - 330 * 60_000;
}

async function supportsBookingEndDate(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS present FROM pragma_table_info('bookings') WHERE name = 'end_date' LIMIT 1").first<{ present: number }>();
  return Boolean(row?.present);
}

async function overlappingBookings(db: D1Database, roomId: number, startsAt: number, endsAt: number) {
  const hasEndDate = await supportsBookingEndDate(db);
  const rows = await db.prepare(`
    SELECT id, booking_ref AS bookingRef, date, ${hasEndDate ? "end_date AS endDate," : ""} start_time AS startTime, end_time AS endTime
    FROM bookings WHERE room_id = ? AND status = 'confirmed'
  `).bind(roomId).all<{ id: number; bookingRef: string; date: string; endDate?: string | null; startTime: string; endTime: string }>();
  return rows.results.filter((booking) => bookingInstant(booking.date, booking.startTime) < endsAt && bookingInstant(booking.date, booking.endTime, true, booking.endDate) > startsAt);
}

export async function createRoomClosure(
  db: D1Database,
  input: { roomId: number; actor: BookingActor; startsAt: unknown; endsAt: unknown; reason: unknown; sourceReportId?: number },
) {
  requireStaff(input.actor);
  const room = await db.prepare("SELECT id FROM rooms WHERE id = ? LIMIT 1").bind(input.roomId).first<{ id: number }>();
  if (!room) throw new RoomReadinessError("Room not found.", 404, "ROOM_NOT_FOUND");
  const startsAt = parseIso(input.startsAt, "startsAt")!;
  const endsAt = parseIso(input.endsAt, "endsAt")!;
  if (Date.parse(startsAt) >= Date.parse(endsAt)) throw new RoomReadinessError("Closure must end after it starts.", 400, "CLOSURE_WINDOW_INVALID");
  if (typeof input.reason !== "string" || input.reason.trim().length < 5) throw new RoomReadinessError("A closure reason of at least 5 characters is required.", 400, "CLOSURE_REASON_REQUIRED");
  const affected = await overlappingBookings(db, input.roomId, Date.parse(startsAt), Date.parse(endsAt));
  if (affected.length > 0) {
    throw new RoomReadinessError(
      "Resolve affected reservations before publishing this closure.",
      409,
      "ROOM_CLOSURE_BOOKING_CONFLICT",
      { bookings: affected.map((booking) => booking.bookingRef), bookingIds: affected.map((booking) => booking.id) },
    );
  }
  const [result] = await db.batch([
    db.prepare(`
    INSERT INTO room_closures (room_id, starts_at, ends_at, reason, source_report_id, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING id, room_id AS roomId, starts_at AS startsAt, ends_at AS endsAt, reason, is_active AS isActive, created_at AS createdAt
    `).bind(input.roomId, startsAt, endsAt, input.reason.trim(), input.sourceReportId ?? null, input.actor.userId),
    db.prepare("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,reason,details) SELECT ?,'closure_created','room_closure',CAST(last_insert_rowid() AS TEXT),?,? WHERE changes()=1")
      .bind(input.actor.userId, input.reason.trim(), JSON.stringify({ roomId: input.roomId, startsAt, endsAt })),
  ]);
  return result.results[0];
}

export async function cancelRoomClosure(db: D1Database, input: { closureId: number; actor: BookingActor; reason?: string }) {
  requireStaff(input.actor);
  if (!input.reason || input.reason.trim().length < 3) throw new RoomReadinessError("A cancellation reason is required.", 400, "CLOSURE_REASON_REQUIRED");
  const closure = await db.prepare("SELECT id FROM room_closures WHERE id = ? AND is_active = 1 LIMIT 1").bind(input.closureId).first<{ id: number }>();
  if (!closure) throw new RoomReadinessError("Active room closure not found.", 404, "CLOSURE_NOT_FOUND");
  await db.batch([
    db.prepare("UPDATE room_closures SET is_active = 0, cancelled_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active=1").bind(input.closureId),
    db.prepare("INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,reason,details) SELECT ?,'closure_cancelled','room_closure',?,?, '{}' WHERE changes()=1")
      .bind(input.actor.userId, String(input.closureId), input.reason.trim()),
  ]);
  return { id: input.closureId, cancelled: true };
}

export async function roomIsClosedForWindow(db: D1Database, roomId: number, date: string, startTime: string, endTime: string, endDate?: string | null): Promise<boolean> {
  const startsAt = bookingInstant(date, startTime);
  const endsAt = bookingInstant(date, endTime, true, endDate);
  const roomColumns = await db.prepare("SELECT name FROM pragma_table_info('rooms')").all<{ name: string }>();
  const hasReadiness = roomColumns.results.some((column) => column.name === "readiness_state");
  const state = hasReadiness
    ? await db.prepare("SELECT readiness_state AS readinessState FROM rooms WHERE id = ? LIMIT 1").bind(roomId).first<{ readinessState: RoomReadinessState }>()
    : { readinessState: "usable" as const };
  if (!state || state.readinessState === "closed") return true;
  const hasClosures = Boolean((await db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'room_closures' LIMIT 1").first<{ present: number }>())?.present);
  if (!hasClosures) return false;
  const closures = await db.prepare("SELECT starts_at AS startsAt, ends_at AS endsAt FROM room_closures WHERE room_id = ? AND is_active = 1").bind(roomId).all<{ startsAt: string; endsAt: string }>();
  return closures.results.some((closure) => Date.parse(closure.startsAt) < endsAt && Date.parse(closure.endsAt) > startsAt);
}
