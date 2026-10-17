import { getInstitutionNow } from "./booking-engine.ts";
import type { BookingActor } from "./booking-lifecycle.ts";

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

function isStaff(actor: BookingActor): boolean {
  return actor.role === "technician" || actor.role === "admin";
}

export async function getRoomReadiness(db: D1Database, roomId: number, now = new Date()): Promise<RoomReadiness | null> {
  const room = await db.prepare(`
    SELECT r.id, r.name, r.code, r.capacity, r.description, r.is_active AS isActive,
      r.location_id AS locationId, l.name AS locationName,
      r.readiness_state AS readinessState, r.readiness_notes AS readinessNotes,
      r.readiness_verified_at AS readinessVerifiedAt
    FROM rooms r LEFT JOIN locations l ON l.id = r.location_id
    WHERE r.id = ? LIMIT 1
  `).bind(roomId).first<RoomReadiness>();
  if (!room) return null;
  const restrictions = await db.prepare(`
    SELECT id, activity_key AS activityKey, state, explanation
    FROM room_restrictions WHERE room_id = ? AND is_active = 1 ORDER BY activity_key, id
  `).bind(roomId).all<RoomReadiness["restrictions"][number]>();
  const activeClosures = await db.prepare(`
    SELECT id, starts_at AS startsAt, ends_at AS endsAt, reason
    FROM room_closures
    WHERE room_id = ? AND is_active = 1 AND ends_at > ?
    ORDER BY starts_at
  `).bind(roomId, now.toISOString()).all<RoomReadiness["activeClosures"][number]>();
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
  if (input.restriction) {
    if (!input.restriction.activityKey.trim() || input.restriction.explanation.trim().length < 3) {
      throw new RoomReadinessError("A restriction activity and explanation are required.", 400, "RESTRICTION_INVALID");
    }
    await db.prepare(`
      INSERT INTO room_restrictions (room_id, activity_key, state, explanation, is_active, created_by_user_id, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
    `).bind(input.roomId, input.restriction.activityKey.trim(), input.restriction.state, input.restriction.explanation.trim(), input.actor.userId).run();
  }
  if (input.state || input.notes !== undefined) {
    await db.prepare(`
      UPDATE rooms SET readiness_state = COALESCE(?, readiness_state), readiness_notes = ?, readiness_verified_at = ?, readiness_verified_by_user_id = ?
      WHERE id = ?
    `).bind(input.state ?? null, input.notes === undefined ? current.readinessNotes : input.notes, new Date().toISOString(), input.actor.userId, input.roomId).run();
  }
  const updated = await getRoomReadiness(db, input.roomId);
  if (!updated) throw new RoomReadinessError("Room disappeared after update.", 500, "ROOM_WRITE_FAILED");
  return updated;
}

export function bookingInstant(date: string, time: string): number {
  const minutes = time === "00:00" ? 1440 : Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day, 0, minutes) - 330 * 60_000;
}

async function overlappingBookings(db: D1Database, roomId: number, startsAt: number, endsAt: number) {
  const rows = await db.prepare(`
    SELECT id, booking_ref AS bookingRef, date, start_time AS startTime, end_time AS endTime
    FROM bookings WHERE room_id = ? AND status = 'confirmed'
  `).bind(roomId).all<{ id: number; bookingRef: string; date: string; startTime: string; endTime: string }>();
  return rows.results.filter((booking) => bookingInstant(booking.date, booking.startTime) < endsAt && bookingInstant(booking.date, booking.endTime) > startsAt);
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
  const result = await db.prepare(`
    INSERT INTO room_closures (room_id, starts_at, ends_at, reason, source_report_id, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING id, room_id AS roomId, starts_at AS startsAt, ends_at AS endsAt, reason, is_active AS isActive, created_at AS createdAt
  `).bind(input.roomId, startsAt, endsAt, input.reason.trim(), input.sourceReportId ?? null, input.actor.userId).first();
  return result;
}

export async function cancelRoomClosure(db: D1Database, input: { closureId: number; actor: BookingActor; reason?: string }) {
  requireStaff(input.actor);
  if (!input.reason || input.reason.trim().length < 3) throw new RoomReadinessError("A cancellation reason is required.", 400, "CLOSURE_REASON_REQUIRED");
  const closure = await db.prepare("SELECT id FROM room_closures WHERE id = ? AND is_active = 1 LIMIT 1").bind(input.closureId).first<{ id: number }>();
  if (!closure) throw new RoomReadinessError("Active room closure not found.", 404, "CLOSURE_NOT_FOUND");
  await db.prepare("UPDATE room_closures SET is_active = 0, cancelled_at = CURRENT_TIMESTAMP WHERE id = ?").bind(input.closureId).run();
  return { id: input.closureId, cancelled: true };
}

export async function roomIsClosedForWindow(db: D1Database, roomId: number, date: string, startTime: string, endTime: string): Promise<boolean> {
  const startsAt = bookingInstant(date, startTime);
  const endsAt = bookingInstant(date, endTime);
  const state = await db.prepare("SELECT readiness_state AS readinessState FROM rooms WHERE id = ? LIMIT 1").bind(roomId).first<{ readinessState: RoomReadinessState }>();
  if (!state || state.readinessState === "closed") return true;
  const closures = await db.prepare("SELECT starts_at AS startsAt, ends_at AS endsAt FROM room_closures WHERE room_id = ? AND is_active = 1").bind(roomId).all<{ startsAt: string; endsAt: string }>();
  return closures.results.some((closure) => Date.parse(closure.startsAt) < endsAt && Date.parse(closure.endsAt) > startsAt);
}
