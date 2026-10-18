import type { D1Database } from "@cloudflare/workers-types";
import type { MovementActor } from "./equipment-movements.ts";

export class MovementPermissionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "MOVEMENT_PERMISSION_INVALID") {
    super(message);
    this.name = "MovementPermissionError";
    this.status = status;
    this.code = code;
  }
}

export interface MovementPermission {
  id: number;
  equipmentId: number;
  equipmentCode: string;
  equipmentName: string;
  equipmentArchived: boolean;
  toLocationId: number;
  toLocationCode: string;
  toLocationName: string;
  isActive: boolean;
  updatedByUserId: number;
  reason: string;
  createdAt: string;
  updatedAt: string;
}

export interface MovementDestination { id: number; code: string; name: string; type: string }

function positiveId(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new MovementPermissionError(`${label} must be a positive integer.`);
  }
  return value;
}

export async function requireActiveMovementActor(db: D1Database, actor: MovementActor, staffOnly = false): Promise<void> {
  positiveId(actor.userId, "User id");
  if (!["student", "technician", "admin"].includes(actor.role) || (staffOnly && actor.role === "student")) {
    throw new MovementPermissionError("Only active staff can manage movement permissions.", 403, "MOVEMENT_FORBIDDEN");
  }
  const user = await db.prepare("SELECT id FROM users WHERE id = ? AND role = ? AND is_active = 1")
    .bind(actor.userId, actor.role).first();
  if (!user) throw new MovementPermissionError("An active account with the matching role is required.", 403, "MOVEMENT_FORBIDDEN");
}

const permissionSelect = `SELECT p.id, p.equipment_id AS equipmentId, e.equipment_id AS equipmentCode,
  e.name AS equipmentName, e.archived AS equipmentArchived, p.to_location_id AS toLocationId,
  l.code AS toLocationCode, l.name AS toLocationName, p.is_active AS isActive,
  p.updated_by_user_id AS updatedByUserId, p.reason, p.created_at AS createdAt, p.updated_at AS updatedAt
  FROM movement_permissions p JOIN equipment e ON e.id = p.equipment_id JOIN locations l ON l.id = p.to_location_id`;

function mapPermission(row: MovementPermission): MovementPermission {
  return { ...row, isActive: Boolean(row.isActive), equipmentArchived: Boolean(row.equipmentArchived) };
}

export async function listMovementPermissions(db: D1Database, actor: MovementActor): Promise<MovementPermission[]> {
  await requireActiveMovementActor(db, actor, true);
  const rows = await db.prepare(`${permissionSelect} ORDER BY e.equipment_id, l.name, p.id`).all<MovementPermission>();
  return rows.results.map(mapPermission);
}

/** A designation and its audit entry commit together. Missing pairs are always denied. */
export async function saveMovementPermission(db: D1Database, actor: MovementActor, value: unknown): Promise<MovementPermission> {
  await requireActiveMovementActor(db, actor, true);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MovementPermissionError("Request body must be a JSON object.");
  const body = value as Record<string, unknown>;
  const equipmentId = positiveId(body.equipmentId, "equipmentId");
  const toLocationId = positiveId(body.toLocationId, "toLocationId");
  if (typeof body.isActive !== "boolean") throw new MovementPermissionError("isActive must be a boolean.");
  if (typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.trim().length > 1000) {
    throw new MovementPermissionError("Reason must contain 5–1000 characters.");
  }
  const reason = body.reason.trim();
  const equipment = await db.prepare("SELECT archived FROM equipment WHERE id = ?").bind(equipmentId).first<{ archived: number }>();
  if (!equipment) throw new MovementPermissionError("Equipment item not found.", 404, "EQUIPMENT_NOT_FOUND");
  if (body.isActive && equipment.archived) throw new MovementPermissionError("Archived equipment cannot be designated for student moves.", 409, "EQUIPMENT_ARCHIVED");
  if (!await db.prepare("SELECT id FROM locations WHERE id = ?").bind(toLocationId).first()) {
    throw new MovementPermissionError("Specified destination does not exist.", 400, "MOVEMENT_DESTINATION_INVALID");
  }
  const updatedAt = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`INSERT INTO movement_permissions (equipment_id, to_location_id, is_active, updated_by_user_id, reason, updated_at)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND role = ? AND is_active = 1)
        AND EXISTS (SELECT 1 FROM equipment WHERE id = ? AND (? = 0 OR archived = 0))
        AND EXISTS (SELECT 1 FROM locations WHERE id = ?)
      ON CONFLICT(equipment_id, to_location_id) DO UPDATE SET is_active = excluded.is_active,
        updated_by_user_id = excluded.updated_by_user_id, reason = excluded.reason, updated_at = excluded.updated_at
      RETURNING id`)
      .bind(equipmentId, toLocationId, body.isActive ? 1 : 0, actor.userId, reason, updatedAt,
        actor.userId, actor.role, equipmentId, body.isActive ? 1 : 0, toLocationId),
    db.prepare(`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details, created_at)
      SELECT ?, 'movement_permission_updated', 'movement_permission', CAST(id AS TEXT), ?, ?, ?
      FROM movement_permissions WHERE equipment_id = ? AND to_location_id = ? AND changes() = 1`)
      .bind(actor.userId, reason, JSON.stringify({ equipmentId, toLocationId, isActive: body.isActive }), updatedAt, equipmentId, toLocationId),
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
    throw new MovementPermissionError("The account or equipment changed. Refresh and retry.", 409, "MOVEMENT_PERMISSION_CONFLICT");
  }
  const row = await db.prepare(`${permissionSelect} WHERE p.equipment_id = ? AND p.to_location_id = ?`)
    .bind(equipmentId, toLocationId).first<MovementPermission>();
  if (!row) throw new Error("Saved movement permission could not be read back.");
  return mapPermission(row);
}

// Both guards refer to the outer `equipment` row. Bind bookingId, ownerId, then destinationId.
// Booking wall clocks use UTC+05:30; a 00:00 end is the following midnight.
const bookingEnd = "julianday(b.date || 'T' || b.end_time, CASE WHEN b.end_time = '00:00' THEN '+1 day' ELSE '+0 day' END, '-330 minutes')";
export const studentMovementSessionGuard = `EXISTS (
  SELECT 1 FROM bookings b JOIN rooms r ON r.id = b.room_id
  WHERE b.id = ? AND b.user_id = ? AND b.status = 'confirmed' AND b.session_ended_at IS NULL
    AND r.is_active = 1 AND r.id = equipment.default_room_id AND r.location_id = equipment.current_location_id
    AND julianday(b.date || 'T' || b.start_time, '-330 minutes') < julianday(strftime('%Y-%m-%dT%H:%M:00Z', 'now'))
    AND ${bookingEnd} > julianday('now')
)`;
export const studentMovementDesignationGuard = `EXISTS (
  SELECT 1 FROM movement_permissions p
  WHERE p.equipment_id = equipment.id AND p.to_location_id = ? AND p.is_active = 1
)`;
// Bind expectedReturnAt twice, then bookingId. The timestamp is strictly validated before binding.
export const studentMovementReturnGuard = `julianday(?) > julianday('now')
  AND julianday(?) <= (SELECT min(julianday('now', '+3 hours'), ${bookingEnd}) FROM bookings b WHERE b.id = ?)`;

async function requireStudentSession(db: D1Database, actor: MovementActor, equipmentId: number, bookingId?: number): Promise<void> {
  positiveId(equipmentId, "Equipment id");
  if (bookingId === undefined) throw new MovementPermissionError("Student equipment moves must be linked to an active reservation.", 403, "MOVEMENT_BOOKING_REQUIRED");
  positiveId(bookingId, "Booking id");
  const eligible = await db.prepare(`SELECT id FROM equipment WHERE id = ? AND archived = 0 AND ${studentMovementSessionGuard}`)
    .bind(equipmentId, bookingId, actor.userId).first();
  if (!eligible) throw new MovementPermissionError("The equipment must be present in your active reservation's room.", 403, "MOVEMENT_SESSION_NOT_ELIGIBLE");
}

export async function assertStudentMovementDesignation(db: D1Database, equipmentId: number, toLocationId: number): Promise<void> {
  positiveId(equipmentId, "Equipment id");
  positiveId(toLocationId, "Destination id");
  const allowed = await db.prepare(`SELECT id FROM movement_permissions WHERE equipment_id = ? AND to_location_id = ? AND is_active = 1`)
    .bind(equipmentId, toLocationId).first();
  if (!allowed) throw new MovementPermissionError("Staff have not designated this equipment for student movement to that destination.", 403, "MOVEMENT_NOT_DESIGNATED");
}

export async function assertStudentMovementAllowed(db: D1Database, input: {
  actor: MovementActor; equipmentId: number; toLocationId: number; bookingId?: number; expectedReturnAt?: string | null;
}): Promise<void> {
  await requireStudentSession(db, input.actor, input.equipmentId, input.bookingId);
  await assertStudentMovementDesignation(db, input.equipmentId, input.toLocationId);
  const returnWindow = input.expectedReturnAt && await db.prepare(`SELECT id FROM equipment WHERE id = ? AND ${studentMovementReturnGuard}`)
    .bind(input.equipmentId, input.expectedReturnAt, input.expectedReturnAt, input.bookingId).first();
  if (!returnWindow) throw new MovementPermissionError("Student moves require a future return time within three hours and before the session ends.", 400, "MOVEMENT_RETURN_WINDOW_INVALID");
}

export async function listMovementDestinations(db: D1Database, actor: MovementActor, equipmentId: number, bookingId?: number): Promise<MovementDestination[]> {
  await requireActiveMovementActor(db, actor);
  positiveId(equipmentId, "Equipment id");
  const equipment = await db.prepare("SELECT archived, current_location_id FROM equipment WHERE id = ?").bind(equipmentId)
    .first<{ archived: number; current_location_id: number }>();
  if (!equipment) throw new MovementPermissionError("Equipment item not found.", 404, "EQUIPMENT_NOT_FOUND");
  if (equipment.archived) throw new MovementPermissionError("Archived equipment cannot be moved.", 409, "EQUIPMENT_ARCHIVED");
  if (actor.role === "student") await requireStudentSession(db, actor, equipmentId, bookingId);
  const rows = actor.role === "student"
    ? await db.prepare(`SELECT l.id, l.code, l.name, l.type FROM locations l JOIN movement_permissions p ON p.to_location_id = l.id
        WHERE p.equipment_id = ? AND p.is_active = 1 AND l.id <> ? ORDER BY l.name`)
      .bind(equipmentId, equipment.current_location_id).all<MovementDestination>()
    : await db.prepare("SELECT id, code, name, type FROM locations WHERE id <> ? ORDER BY name")
      .bind(equipment.current_location_id).all<MovementDestination>();
  return rows.results;
}
