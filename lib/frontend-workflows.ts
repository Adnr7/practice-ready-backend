import type { BookingActor, BookingRow } from "./booking-lifecycle.ts";
import { getBookingRow } from "./booking-lifecycle.ts";

export class FrontendWorkflowError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, status: FrontendWorkflowError["status"] = 400, code = "WORKFLOW_ERROR", details?: Record<string, unknown>) {
    super(message);
    this.name = "FrontendWorkflowError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function workflowErrorResponse(error: unknown): Response {
  if (error instanceof FrontendWorkflowError) {
    return Response.json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
}

export function parseId(value: string, label: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new FrontendWorkflowError(`${label} must be a positive integer.`, 400, "ID_INVALID");
  return id;
}

export function requireStaff(actor: BookingActor): void {
  if (actor.role !== "technician" && actor.role !== "admin") throw new FrontendWorkflowError("Only staff can perform this operation.", 403, "STAFF_FORBIDDEN");
}

export function requireAdmin(actor: BookingActor): void {
  if (actor.role !== "admin") throw new FrontendWorkflowError("Only administrators can perform this operation.", 403, "ADMIN_FORBIDDEN");
}

export function parseBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new FrontendWorkflowError("Request body must be a JSON object.", 400, "BODY_INVALID");
  return body as Record<string, unknown>;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return parseBody(await request.json());
  } catch (error) {
    if (error instanceof FrontendWorkflowError) throw error;
    throw new FrontendWorkflowError("Request body must be valid JSON.", 400, "INVALID_JSON");
  }
}

type Actor = BookingActor;

export async function assertBookingOwnerOrStaff(db: D1Database, bookingId: number, actor: Actor): Promise<BookingRow> {
  const booking = await getBookingRow(db, bookingId);
  if (!booking) throw new FrontendWorkflowError("Booking not found.", 404, "BOOKING_NOT_FOUND");
  if (actor.role === "student" && booking.userId !== actor.userId) throw new FrontendWorkflowError("You do not have access to this booking.", 403, "BOOKING_FORBIDDEN");
  return booking;
}

function parseAttachmentIds(value: unknown): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) throw new FrontendWorkflowError("A journal can contain up to three attachments.", 400, "ATTACHMENTS_INVALID");
  const ids = [...new Set(value.map(Number))];
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new FrontendWorkflowError("Attachment IDs must be positive integers.", 400, "ATTACHMENTS_INVALID");
  return ids;
}

export async function getJournal(db: D1Database, bookingId: number, actor: Actor) {
  const booking = await assertBookingOwnerOrStaff(db, bookingId, actor);
  const row = await db.prepare(`
    SELECT id, booking_id AS bookingId, user_id AS userId, note, attachment_ids AS attachmentIds,
      created_at AS createdAt, updated_at AS updatedAt
    FROM practice_journal_entries WHERE booking_id = ? AND user_id = ? LIMIT 1
  `).bind(bookingId, booking.userId ?? actor.userId).first<{ id: number; bookingId: number; userId: number; note: string; attachmentIds: string; createdAt: string; updatedAt: string }>();
  if (!row) return null;
  let attachmentIds: number[] = [];
  try { attachmentIds = JSON.parse(row.attachmentIds) as number[]; } catch { attachmentIds = []; }
  return { ...row, attachmentIds };
}

export async function saveJournal(db: D1Database, bookingId: number, actor: Actor, input: { note?: unknown; attachmentIds?: unknown }) {
  const booking = await assertBookingOwnerOrStaff(db, bookingId, actor);
  if (actor.role !== "student" || booking.userId !== actor.userId) throw new FrontendWorkflowError("Only the booking owner can save a practice journal.", 403, "JOURNAL_FORBIDDEN");
  if (booking.status === "cancelled") throw new FrontendWorkflowError("Cancelled bookings cannot have practice journal entries.", 409, "JOURNAL_BOOKING_CANCELLED");
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 4000) throw new FrontendWorkflowError("Journal notes must be 4,000 characters or fewer.", 400, "JOURNAL_NOTE_TOO_LONG");
  const attachmentIds = parseAttachmentIds(input.attachmentIds);
  if (!note && attachmentIds.length === 0) throw new FrontendWorkflowError("Add a note or attachment before saving.", 400, "JOURNAL_EMPTY");
  if (attachmentIds.length > 0) {
    const placeholders = attachmentIds.map(() => "?").join(", ");
    const owned = await db.prepare(`SELECT count(*) AS count FROM attachments WHERE owner_user_id = ? AND id IN (${placeholders})`).bind(actor.userId, ...attachmentIds).first<{ count: number }>();
    if (Number(owned?.count ?? 0) !== attachmentIds.length) throw new FrontendWorkflowError("One or more attachments are not owned by this account.", 403, "ATTACHMENT_FORBIDDEN");
  }
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO practice_journal_entries (booking_id, user_id, note, attachment_ids, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(booking_id, user_id) DO UPDATE SET note = excluded.note, attachment_ids = excluded.attachment_ids, updated_at = excluded.updated_at
  `).bind(bookingId, actor.userId, note, JSON.stringify(attachmentIds), now).run();
  return getJournal(db, bookingId, actor);
}

export async function getBookingHistory(db: D1Database, bookingId: number, actor: Actor) {
  await assertBookingOwnerOrStaff(db, bookingId, actor);
  const history = await db.prepare(`
    SELECT h.id, h.booking_id AS bookingId, h.actor_user_id AS actorUserId, u.full_name AS actorName,
      h.action, h.previous_room_id AS previousRoomId, h.previous_date AS previousDate,
      h.previous_start_time AS previousStartTime, h.previous_end_time AS previousEndTime,
      h.new_room_id AS newRoomId, h.new_date AS newDate, h.new_start_time AS newStartTime,
      h.new_end_time AS newEndTime, h.reason, h.created_at AS createdAt
    FROM booking_history h LEFT JOIN users u ON u.id = h.actor_user_id
    WHERE h.booking_id = ? ORDER BY h.created_at ASC, h.id ASC
  `).bind(bookingId).all();
  const usage = await db.prepare(`
    SELECT id, equipment_id AS equipmentId, equipment_label AS equipmentLabel, equipment_code AS equipmentCode,
      observed_location_id AS observedLocationId, observed_condition AS observedCondition,
      observed_status AS observedStatus, observed_at AS observedAt, created_at AS createdAt
    FROM session_equipment_usage WHERE booking_id = ? ORDER BY id
  `).bind(bookingId).all();
  const movementQuery = actor.role === "student" ? `
    SELECT m.id, m.equipment_id AS equipmentId, e.name AS equipmentName, e.equipment_id AS equipmentCode,
      m.from_location_id AS fromLocationId, fromLoc.name AS fromLocationName,
      m.to_location_id AS toLocationId, toLoc.name AS toLocationName, m.status,
      m.expected_return_at AS expectedReturnAt, m.moved_at AS movedAt, m.returned_at AS returnedAt
    FROM equipment_movements m JOIN equipment e ON e.id = m.equipment_id
      JOIN locations fromLoc ON fromLoc.id = m.from_location_id JOIN locations toLoc ON toLoc.id = m.to_location_id
    WHERE m.moved_by_user_id = ? AND m.reservation_id = ?
    ORDER BY m.moved_at ASC, m.id ASC
  ` : `
    SELECT m.id, m.equipment_id AS equipmentId, e.name AS equipmentName, e.equipment_id AS equipmentCode,
      m.from_location_id AS fromLocationId, fromLoc.name AS fromLocationName,
      m.to_location_id AS toLocationId, toLoc.name AS toLocationName, m.status,
      m.expected_return_at AS expectedReturnAt, m.moved_at AS movedAt, m.returned_at AS returnedAt
    FROM equipment_movements m JOIN equipment e ON e.id = m.equipment_id
      JOIN locations fromLoc ON fromLoc.id = m.from_location_id JOIN locations toLoc ON toLoc.id = m.to_location_id
    WHERE m.reservation_id = ?
    ORDER BY m.moved_at ASC, m.id ASC
  `;
  const movements = actor.role === "student"
    ? await db.prepare(movementQuery).bind(actor.userId, bookingId).all()
    : await db.prepare(movementQuery).bind(bookingId).all();
  const reportsQuery = actor.role === "student" ? `
    SELECT r.id, r.reference, r.category, r.issue_type AS issueType, r.description,
      r.attachment_ids AS attachmentIds, r.status, r.created_at AS createdAt,
      r.updated_at AS updatedAt, r.resolved_at AS resolvedAt
    FROM reports r WHERE r.booking_id = ? AND r.reporter_id = ? ORDER BY r.created_at ASC, r.id ASC
  ` : `
    SELECT r.id, r.reference, r.category, r.issue_type AS issueType, r.description,
      r.attachment_ids AS attachmentIds, r.status, r.created_at AS createdAt,
      r.updated_at AS updatedAt, r.resolved_at AS resolvedAt
    FROM reports r WHERE r.booking_id = ? ORDER BY r.created_at ASC, r.id ASC
  `;
  const reports = actor.role === "student"
    ? await db.prepare(reportsQuery).bind(bookingId, actor.userId).all()
    : await db.prepare(reportsQuery).bind(bookingId).all();
  const reportResults = reports.results.map((report) => {
    const row = report as Record<string, unknown> & { attachmentIds?: string | number[] };
    let attachmentIds: number[] = [];
    try {
      const parsed = typeof row.attachmentIds === "string" ? JSON.parse(row.attachmentIds) : row.attachmentIds;
      if (Array.isArray(parsed)) attachmentIds = parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0);
    } catch { attachmentIds = []; }
    return { ...row, attachmentIds };
  });
  return { history: history.results, usage: usage.results, movements: movements.results, reports: reportResults };
}

export async function createAttachment(db: D1Database, actor: Actor, input: Record<string, unknown>) {
  const dataUrl = typeof input.dataUrl === "string" ? input.dataUrl : "";
  const mediaType = typeof input.mediaType === "string" ? input.mediaType : "";
  const fileName = typeof input.fileName === "string" ? input.fileName.trim().slice(0, 180) : "upload";
  const dataUrlMatch = /^data:(image\/(?:jpeg|png|webp));base64,[A-Za-z0-9+/=]+$/.exec(dataUrl);
  if (!dataUrlMatch || dataUrlMatch[1] !== mediaType || !["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    throw new FrontendWorkflowError("Only JPEG, PNG, and WebP image data is supported.", 400, "ATTACHMENT_TYPE_INVALID");
  }
  if (dataUrl.length > 500_000) throw new FrontendWorkflowError("Image attachment is too large.", 413, "ATTACHMENT_TOO_LARGE");
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const byteSize = Math.max(0, Math.floor((encoded.length * 3) / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0));
  const inserted = await db.prepare(`
    INSERT INTO attachments (owner_user_id, file_name, media_type, byte_size, data_url)
    VALUES (?, ?, ?, ?, ?) RETURNING id, file_name AS fileName, media_type AS mediaType, byte_size AS byteSize, created_at AS createdAt
  `).bind(actor.userId, fileName || "upload", mediaType, byteSize, dataUrl).first();
  return inserted;
}

export async function getAttachment(db: D1Database, attachmentId: number, actor: Actor) {
  const row = await db.prepare("SELECT id, owner_user_id AS ownerUserId, file_name AS fileName, media_type AS mediaType, byte_size AS byteSize, data_url AS dataUrl, created_at AS createdAt FROM attachments WHERE id = ? LIMIT 1").bind(attachmentId).first<{ id: number; ownerUserId: number; fileName: string; mediaType: string; byteSize: number; dataUrl: string; createdAt: string }>();
  if (!row) throw new FrontendWorkflowError("Attachment not found.", 404, "ATTACHMENT_NOT_FOUND");
  if (actor.role === "student" && row.ownerUserId !== actor.userId) throw new FrontendWorkflowError("You do not have access to this attachment.", 403, "ATTACHMENT_FORBIDDEN");
  return row;
}
