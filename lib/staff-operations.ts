import type { BookingActor } from "./booking-lifecycle.ts";
import { getRoomReadiness } from "./room-readiness.ts";
import { operationalConflictResponse } from "./operational-conflicts.ts";

export class StaffOperationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 400, code = "STAFF_OPERATION_INVALID") {
    super(message);
    this.name = "StaffOperationError";
    this.status = status;
    this.code = code;
  }
}

export function staffOperationErrorResponse(error: unknown): Response {
  const conflict = operationalConflictResponse(error);
  if (conflict) return conflict;
  if (error instanceof StaffOperationError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
}

export function requireStaffActor(actor: BookingActor): void {
  if (actor.role !== "technician" && actor.role !== "admin") throw new StaffOperationError("Only staff can perform this operation.", 403, "STAFF_FORBIDDEN");
}

function parseBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new StaffOperationError("Request body must be a JSON object.");
  return body as Record<string, unknown>;
}

export async function readStaffJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new StaffOperationError("Request body must be valid JSON.", 400, "INVALID_JSON"); }
  return parseBody(body);
}

export function parseStaffId(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new StaffOperationError("ID must be a positive integer.", 400, "ID_INVALID");
  return Number(value);
}

const staffExists = "EXISTS (SELECT 1 FROM users WHERE id = ? AND is_active = 1 AND role IN ('technician', 'admin'))";
const roomColumns = `id, name, code, capacity, description, is_active AS isActive, location_id AS locationId,
  readiness_state AS readinessState, readiness_notes AS readinessNotes`;
const equipmentColumns = `id, equipment_id AS equipmentId, name, type, model_name AS modelName, condition, status,
  default_location_id AS defaultLocationId, current_location_id AS currentLocationId, default_room_id AS defaultRoomId,
  notes, archived, photo_attachment_id AS photoAttachmentId, last_inspected_at AS lastInspectedAt`;

// Reservation clocks are institution-local (UTC+05:30); midnight end means the following day.
async function supportsBookingEndDate(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS present FROM pragma_table_info('bookings') WHERE name = 'end_date' LIMIT 1").first<{ present: number }>();
  return Boolean(row?.present);
}

function bookingEnd(hasEndDate: boolean): string {
  return hasEndDate
    ? "julianday(COALESCE(b.end_date, b.date) || 'T' || b.end_time, CASE WHEN COALESCE(b.end_date, b.date) = b.date AND b.end_time = '00:00' THEN '+1 day' ELSE '+0 day' END, '-330 minutes')"
    : "julianday(b.date || 'T' || b.end_time, CASE WHEN b.end_time = '00:00' THEN '+1 day' ELSE '+0 day' END, '-330 minutes')";
}
const bookingStart = "julianday(b.date || 'T' || b.start_time, '-330 minutes')";

function invalid(message: string, code = "CATALOG_INPUT_INVALID"): never {
  throw new StaffOperationError(message, 400, code);
}

function text(value: unknown, label: string, max = 200, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) invalid(`${label} must contain ${min}–${max} characters.`);
  return value.trim();
}

function nullableText(value: unknown, label: string, max = 200): string | null {
  if (value === null || value === "") return null;
  return text(value, label, max);
}

function id(value: unknown, label: string, nullable = false): number | null {
  if (value === null && nullable) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) invalid(`${label} must be a positive integer${nullable ? " or null" : ""}.`);
  return value;
}

function flag(value: unknown, label: string): number {
  if (typeof value !== "boolean") invalid(`${label} must be a boolean.`);
  return value ? 1 : 0;
}

function iso(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) invalid(`${label} must be a timestamp with a timezone.`, "TIMESTAMP_INVALID");
  return new Date(value).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.message} ${errorMessage(error.cause)}` : "";
}

async function activeStaff(db: D1Database, actor: BookingActor) {
  requireStaffActor(actor);
  if (!await db.prepare(`SELECT 1 AS allowed WHERE ${staffExists}`).bind(actor.userId).first()) {
    throw new StaffOperationError("An active staff account is required.", 403, "STAFF_FORBIDDEN");
  }
}

async function reference(db: D1Database, table: "locations" | "rooms" | "attachments", value: number | null, label: string) {
  if (value !== null && !await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(value).first()) invalid(`${label} does not exist.`, "CATALOG_REFERENCE_INVALID");
}

/** Audit follows the mutation immediately: changes() gates it, and last_insert_rowid() is never read after another insert. */
function catalogAudit(db: D1Database, actor: BookingActor, entity: string, entityId: number | undefined, reason: string, details: unknown) {
  return db.prepare(`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details)
    SELECT ?, ?, ?, ${entityId === undefined ? "CAST(last_insert_rowid() AS TEXT)" : "?"}, ?, ? WHERE changes() = 1`)
    .bind(actor.userId, entityId === undefined ? "created" : "updated", entity, ...(entityId === undefined ? [] : [String(entityId)]), reason, JSON.stringify(details));
}

async function catalogBatch<T>(db: D1Database, statements: D1PreparedStatement[]): Promise<T> {
  try {
    const [result] = await db.batch<T>(statements);
    if (!result.results[0]) throw new StaffOperationError("Catalog change conflicted with active reservations, movements, repairs, or a changed reference. Refresh and resolve those items first.", 409, "CATALOG_CONFLICT");
    return result.results[0];
  } catch (error) {
    if (/UNIQUE constraint failed: (rooms.code|equipment.equipment_id)/i.test(errorMessage(error))) throw new StaffOperationError("That catalog code is already in use.", 409, "CATALOG_CODE_EXISTS");
    throw error;
  }
}

export type StaffRoom = { id: number; name: string; code: string; capacity: number; description: string; isActive: number | boolean; locationId: number | null; readinessState: string; readinessNotes: string | null };
export type StaffEquipment = { id: number; equipmentId: string; name: string; type: string; modelName: string | null; condition: string; status: string; defaultLocationId: number | null; currentLocationId: number; defaultRoomId: number | null; notes: string | null; archived: number | boolean; photoAttachmentId: number | null; lastInspectedAt: string | null };

/** Room deletion is archival so historical bookings, reports and equipment retain their references. */
export async function saveRoomCatalog(db: D1Database, actor: BookingActor, value: unknown, roomId?: number): Promise<StaffRoom> {
  await activeStaff(db, actor);
  const body = parseBody(value);
  const reason = text(body.reason, "Reason", 1000, 5);
  if (roomId !== undefined) {
    id(roomId, "Room id");
    if (!await db.prepare("SELECT id FROM rooms WHERE id = ?").bind(roomId).first()) throw new StaffOperationError("Room not found.", 404, "ROOM_NOT_FOUND");
  }
  const values: Record<string, string | number | null> = {};
  if (roomId === undefined || body.name !== undefined) values.name = text(body.name, "Room name");
  if (roomId === undefined || body.code !== undefined) {
    const code = text(body.code, "Room code", 80);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) invalid("Room code must use lowercase letters, numbers and single hyphens.");
    values.code = code;
  }
  if (roomId === undefined || body.capacity !== undefined) {
    if (typeof body.capacity !== "number" || !Number.isSafeInteger(body.capacity) || body.capacity < 1 || body.capacity > 1000) invalid("Capacity must be an integer between 1 and 1,000.");
    values.capacity = body.capacity;
  }
  if (roomId === undefined || body.description !== undefined) values.description = text(body.description, "Description", 4000);
  if (roomId === undefined || body.locationId !== undefined) {
    values.location_id = id(body.locationId, "Location id");
    await reference(db, "locations", values.location_id as number, "Room location");
  }
  if (body.isActive !== undefined) values.is_active = flag(body.isActive, "isActive");
  if (Object.keys(values).length === 0) invalid("Supply at least one room catalog change.");
  const entries = Object.entries(values);
  const locationGuard = values.location_id === undefined ? "" : " AND EXISTS (SELECT 1 FROM locations WHERE id = ?)";
  const endExpression = bookingEnd(await supportsBookingEndDate(db));
  const reservationGuard = values.is_active === 0 && roomId !== undefined
    ? ` AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = rooms.id AND b.status = 'confirmed' AND ${endExpression} > julianday('now'))` : "";
  const mutation = roomId === undefined
    ? db.prepare(`INSERT INTO rooms (${entries.map(([key]) => key).join(", ")}) SELECT ${entries.map(() => "?").join(", ")} WHERE ${staffExists}${locationGuard} RETURNING ${roomColumns}`)
      .bind(...entries.map(([, item]) => item), actor.userId, ...(values.location_id === undefined ? [] : [values.location_id]))
    : db.prepare(`UPDATE rooms SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ? AND ${staffExists}${locationGuard}${reservationGuard} RETURNING ${roomColumns}`)
      .bind(...entries.map(([, item]) => item), roomId, actor.userId, ...(values.location_id === undefined ? [] : [values.location_id]));
  return catalogBatch<StaffRoom>(db, [mutation, catalogAudit(db, actor, "room", roomId, reason, values)]);
}

export async function saveEquipmentCatalog(db: D1Database, actor: BookingActor, value: unknown, equipmentId?: number): Promise<StaffEquipment> {
  await activeStaff(db, actor);
  const body = parseBody(value);
  const reason = text(body.reason, "Reason", 1000, 5);
  if (equipmentId !== undefined) {
    id(equipmentId, "Equipment id");
    if (!await db.prepare("SELECT id FROM equipment WHERE id = ?").bind(equipmentId).first()) throw new StaffOperationError("Equipment not found.", 404, "EQUIPMENT_NOT_FOUND");
  }
  const values: Record<string, string | number | null> = {};
  for (const [key, column] of [["equipmentId", "equipment_id"], ["name", "name"], ["type", "type"]] as const) {
    if (equipmentId === undefined || body[key] !== undefined) values[column] = text(body[key], key);
  }
  for (const [key, column, max] of [["modelName", "model_name", 200], ["notes", "notes", 4000]] as const) {
    if (body[key] !== undefined) values[column] = nullableText(body[key], key, max);
  }
  if (equipmentId === undefined || body.condition !== undefined) values.condition = text(body.condition === undefined ? "Unknown" : body.condition, "Condition", 500);
  if (equipmentId === undefined || body.status !== undefined) {
    const status = body.status === undefined ? "attention" : body.status;
    if (typeof status !== "string" || !["ready", "away", "attention", "service", "missing"].includes(status)) invalid("Invalid equipment status.");
    values.status = status;
  }
  const guards: string[] = [];
  const bindings: Array<string | number | null> = [];
  for (const [key, column, table, nullable] of [
    ["defaultLocationId", "default_location_id", "locations", true],
    ["currentLocationId", "current_location_id", "locations", false],
    ["defaultRoomId", "default_room_id", "rooms", true],
    ["photoAttachmentId", "photo_attachment_id", "attachments", true],
  ] as const) {
    const input = equipmentId === undefined && key === "currentLocationId" && body.currentLocationId === undefined ? body.defaultLocationId : body[key];
    if (input !== undefined || (equipmentId === undefined && key === "currentLocationId")) {
      const ref = id(input, key, nullable);
      await reference(db, table, ref, key);
      values[column] = ref;
      if (ref !== null) { guards.push(`EXISTS (SELECT 1 FROM ${table} WHERE id = ?)`); bindings.push(ref); }
    }
  }
  if (body.archived !== undefined) values.archived = flag(body.archived, "archived");
  if (Object.keys(values).length === 0) invalid("Supply at least one equipment change.");
  if (equipmentId !== undefined) {
    // Location changes belong to the movement ledger, not an untracked catalog edit.
    if (values.current_location_id !== undefined) { guards.push("current_location_id = ?"); bindings.push(values.current_location_id); }
    if (values.archived === 1 || values.status === "ready") {
      guards.push("NOT EXISTS (SELECT 1 FROM equipment_movements WHERE equipment_id = equipment.id AND status = 'open')");
      guards.push("NOT EXISTS (SELECT 1 FROM repair_jobs WHERE equipment_id = equipment.id AND stage <> 'completed')");
    }
  }
  const entries = Object.entries(values);
  const where = `${staffExists}${guards.map((guard) => ` AND ${guard}`).join("")}`;
  const mutation = equipmentId === undefined
    ? db.prepare(`INSERT INTO equipment (${entries.map(([key]) => key).join(", ")}) SELECT ${entries.map(() => "?").join(", ")} WHERE ${where} RETURNING ${equipmentColumns}`)
      .bind(...entries.map(([, item]) => item), actor.userId, ...bindings)
    : db.prepare(`UPDATE equipment SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ? AND ${where} RETURNING ${equipmentColumns}`)
      .bind(...entries.map(([, item]) => item), equipmentId, actor.userId, ...bindings);
  // Catalog editing never fabricates an inspection timestamp.
  return catalogBatch<StaffEquipment>(db, [mutation, catalogAudit(db, actor, "equipment", equipmentId, reason, values)]);
}

type ReportSnapshot = { id: number; status: string; updatedAt: string; equipmentId: number | null; roomId: number | null; category: string };
export type ReportActionResult = { action: "repair" | "closure"; reportId: number; linkedId: number };

/** All links, status/history, equipment impact and audit are one D1 transaction. No last-row lookup after commit. */
export async function actOnReport(db: D1Database, actor: BookingActor, reportId: number, value: unknown): Promise<ReportActionResult> {
  await activeStaff(db, actor);
  id(reportId, "Report id");
  const body = parseBody(value);
  if (body.action !== "repair" && body.action !== "closure") invalid("Action must be repair or closure.", "REPORT_ACTION_INVALID");
  const action = body.action;
  const reason = text(body.reason, "Reason", 1000, 5);
  const expectedUpdatedAt = text(body.expectedUpdatedAt, "Report updatedAt", 80);
  const expectedStatus = text(body.expectedStatus, "Report status", 30);
  const report = await db.prepare("SELECT id, status, updated_at AS updatedAt, equipment_id AS equipmentId, room_id AS roomId, category FROM reports WHERE id = ?").bind(reportId).first<ReportSnapshot>();
  if (!report) throw new StaffOperationError("Report not found.", 404, "REPORT_NOT_FOUND");
  const target = action === "repair" ? report.equipmentId : report.roomId;
  if (!target || (action === "repair" && report.category !== "equipment")) invalid(`This report has no ${action === "repair" ? "equipment" : "room"} target.`, "REPORT_TARGET_INVALID");
  const now = new Date().toISOString();
  const reportGuard = `r.id = ? AND r.updated_at = ? AND r.status = ? AND r.status NOT IN ('resolved', 'closed')
    AND NOT EXISTS (SELECT 1 FROM repair_jobs WHERE source_report_id = r.id)
    AND NOT EXISTS (SELECT 1 FROM room_closures WHERE source_report_id = r.id) AND ${staffExists}`;
  let insert: D1PreparedStatement;
  const statements: D1PreparedStatement[] = [];
  if (action === "repair") {
    const expectedReturnAt = body.expectedReturnAt === undefined || body.expectedReturnAt === null ? null : iso(body.expectedReturnAt, "Expected return");
    const privateNote = body.privateNote === undefined ? null : nullableText(body.privateNote, "Private note", 4000);
    insert = db.prepare(`INSERT INTO repair_jobs (equipment_id, source_report_id, stage, expected_return_at, opened_by_user_id)
      SELECT r.equipment_id, r.id, 'reported', ?, ? FROM reports r JOIN equipment e ON e.id = r.equipment_id
      WHERE ${reportGuard} AND r.equipment_id = ? AND r.category = 'equipment' AND e.archived = 0
        AND NOT EXISTS (SELECT 1 FROM repair_jobs WHERE equipment_id = e.id AND stage <> 'completed') RETURNING id`)
      .bind(expectedReturnAt, actor.userId, reportId, expectedUpdatedAt, expectedStatus, actor.userId, target);
    statements.push(insert,
      db.prepare(`INSERT INTO repair_updates (repair_job_id, stage, expected_return_at, public_message, private_note, actor_user_id)
        SELECT id, 'reported', ?, ?, ?, ? FROM repair_jobs WHERE source_report_id = ? AND changes() = 1`)
        .bind(expectedReturnAt, reason, privateNote, actor.userId, reportId),
      db.prepare("UPDATE equipment SET status = 'service' WHERE id = ? AND changes() = 1").bind(target));
  } else {
    const startsAt = iso(body.startsAt, "Closure start");
    const endsAt = iso(body.endsAt, "Closure end");
    const endExpression = bookingEnd(await supportsBookingEndDate(db));
    if (startsAt >= endsAt) invalid("Closure must end after it starts.", "CLOSURE_WINDOW_INVALID");
    insert = db.prepare(`INSERT INTO room_closures (room_id, starts_at, ends_at, reason, source_report_id, created_by_user_id)
      SELECT r.room_id, ?, ?, ?, r.id, ? FROM reports r JOIN rooms rm ON rm.id = r.room_id
      WHERE ${reportGuard} AND r.room_id = ? AND rm.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.room_id AND b.status = 'confirmed'
           AND ${bookingStart} < julianday(?) AND ${endExpression} > julianday(?))
        AND NOT EXISTS (SELECT 1 FROM room_closures c WHERE c.room_id = r.room_id AND c.is_active = 1
          AND julianday(c.starts_at) < julianday(?) AND julianday(c.ends_at) > julianday(?)) RETURNING id`)
      .bind(startsAt, endsAt, reason, actor.userId, reportId, expectedUpdatedAt, expectedStatus, actor.userId, target, endsAt, startsAt, endsAt, startsAt);
    statements.push(insert);
  }
  const table = action === "repair" ? "repair_jobs" : "room_closures";
  statements.push(
    db.prepare("UPDATE reports SET status = 'in_progress', updated_at = ?, resolved_at = NULL WHERE id = ? AND changes() = 1").bind(now, reportId),
    db.prepare(`INSERT INTO report_updates (report_id, author_id, status, message)
      SELECT ?, ?, 'in_progress', ? || ' [' || ? || ' #' || (SELECT id FROM ${table} WHERE source_report_id = ?) || ']' WHERE changes() = 1`)
      .bind(reportId, actor.userId, reason, action, reportId),
    db.prepare(`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details)
      SELECT ?, ?, 'report', ?, ?, json_object('linkedId', (SELECT id FROM ${table} WHERE source_report_id = ?), 'targetId', ?, 'previousStatus', ?) WHERE changes() = 1`)
      .bind(actor.userId, `report_to_${action}`, String(reportId), reason, reportId, target, expectedStatus));
  const [result] = await db.batch<{ id: number }>(statements);
  if (!result.results[0]) {
    throw new StaffOperationError("Report changed or is already linked, the equipment has an open repair, or the closure overlaps a reservation/closure. Refresh and resolve the conflict before retrying.", 409, "REPORT_ACTION_CONFLICT");
  }
  return { action, reportId, linkedId: result.results[0].id };
}

export async function getStaffOperations(db: D1Database, actor: BookingActor) {
  await activeStaff(db, actor);
  const [roomRows, equipment, locations, repairs, inspections, roomProfiles, reportLinks] = await Promise.all([
    db.prepare("SELECT id FROM rooms ORDER BY name").all<{ id: number }>(),
    db.prepare(`SELECT ${equipmentColumns} FROM equipment ORDER BY archived, type, name`).all<StaffEquipment>(),
    db.prepare("SELECT id, code, name, type FROM locations ORDER BY name").all<{ id: number; code: string; name: string; type: string }>(),
    db.prepare(`SELECT j.id, j.equipment_id AS equipmentId, e.name AS equipmentName, j.source_report_id AS sourceReportId,
      j.stage, j.expected_return_at AS expectedReturnAt, j.opened_at AS openedAt, j.completed_at AS completedAt,
      u.public_message AS publicMessage, u.private_note AS privateNote
      FROM repair_jobs j JOIN equipment e ON e.id = j.equipment_id
      LEFT JOIN repair_updates u ON u.id = (SELECT id FROM repair_updates WHERE repair_job_id = j.id ORDER BY id DESC LIMIT 1)
      ORDER BY j.id DESC LIMIT 200`).all<{ id: number; equipmentId: number; equipmentName: string; sourceReportId: number | null; stage: string; expectedReturnAt: string | null; openedAt: string; completedAt: string | null; publicMessage: string | null; privateNote: string | null }>(),
    db.prepare(`SELECT id, equipment_id AS equipmentId, repair_job_id AS repairJobId, result, condition, notes, observed_at AS observedAt
      FROM equipment_inspections ORDER BY id DESC LIMIT 200`).all<{ id: number; equipmentId: number; repairJobId: number | null; result: string; condition: string; notes: string | null; observedAt: string }>(),
    db.prepare("SELECT room_id AS roomId, profile_id AS profileId, state, explanation FROM room_practice_types ORDER BY room_id, profile_id").all<{ roomId: number; profileId: number; state: string; explanation: string }>(),
    db.prepare(`SELECT source_report_id AS reportId, id AS linkedId, 'repair' AS action FROM repair_jobs WHERE source_report_id IS NOT NULL
      UNION ALL SELECT source_report_id AS reportId, id AS linkedId, 'closure' AS action FROM room_closures WHERE source_report_id IS NOT NULL`)
      .all<{ reportId: number; linkedId: number; action: "repair" | "closure" }>(),
  ]);
  const rooms = (await Promise.all(roomRows.results.map((room) => getRoomReadiness(db, room.id)))).filter((room) => room !== null);
  return { rooms, equipment: equipment.results, locations: locations.results, repairs: repairs.results, inspections: inspections.results, roomProfiles: roomProfiles.results, reportLinks: reportLinks.results };
}
