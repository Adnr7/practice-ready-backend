import type { D1Database } from "@cloudflare/workers-types";
import {
  assertStudentMovementAllowed,
  MovementPermissionError,
  requireActiveMovementActor,
  studentMovementReturnGuardFor,
  studentMovementSessionGuardFor,
  supportsBookingEndDate,
  studentMovementDesignationGuard,
} from "./movement-permissions.ts";

export type MovementRole = "student" | "technician" | "admin";

export interface MovementActor {
  userId: number;
  role: MovementRole;
}

export interface MovementRecord {
  id: number;
  equipmentId: number;
  equipmentCode: string;
  equipmentName: string;
  equipmentCurrentLocationId: number;
  movedByUserId: number;
  fromLocationId: number;
  fromLocationCode: string;
  fromLocationName: string;
  toLocationId: number;
  toLocationCode: string;
  toLocationName: string;
  status: "open" | "returned" | "corrected";
  expectedReturnAt: string | null;
  movedAt: string;
  returnedAt: string | null;
  returnedByUserId: number | null;
  returnLocationId: number | null;
  notes: string | null;
  reservationId: number | null;
  correctionReason: string | null;
  updatedAt: string;
  returnEvents: MovementReturnEvent[];
}

export interface MovementReturnEvent {
  id: number;
  movementId: number;
  actorUserId: number;
  fromLocationId: number;
  toLocationId: number;
  eventType: "return" | "correction";
  notes: string | null;
  createdAt: string;
}

export interface CreateMovementInput {
  actor: MovementActor;
  equipmentId: number;
  toLocationId: number;
  fromLocationId?: number;
  expectedReturnAt?: string | null;
  notes?: string | null;
  bookingId?: number;
}

export interface ReturnMovementInput {
  actor: MovementActor;
  movementId: number;
  returnLocationId?: number;
  notes?: string | null;
}

export interface CorrectMovementInput {
  actor: MovementActor;
  movementId: number;
  locationId: number;
  reason: string;
  notes?: string | null;
}

export class MovementError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code = "MOVEMENT_ERROR",
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MovementError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface EquipmentRow {
  id: number;
  equipment_id: string;
  name: string;
  current_location_id: number;
  status: string;
  archived: number;
}

interface LocationRow {
  id: number;
  code: string;
  name: string;
  type: string;
}

interface MovementRow {
  movement_id: number;
  equipment_id: number;
  equipment_code: string;
  equipment_name: string;
  equipment_current_location_id: number;
  moved_by_user_id: number;
  from_location_id: number;
  from_location_code: string;
  from_location_name: string;
  to_location_id: number;
  to_location_code: string;
  to_location_name: string;
  status: "open" | "returned" | "corrected";
  expected_return_at: string | null;
  moved_at: string;
  returned_at: string | null;
  returned_by_user_id: number | null;
  return_location_id: number | null;
  notes: string | null;
  reservation_id: number | null;
  correction_reason: string | null;
  updated_at: string;
}

interface EventRow {
  id: number;
  movement_id: number;
  actor_user_id: number;
  from_location_id: number;
  to_location_id: number;
  event_type: "return" | "correction";
  notes: string | null;
  created_at: string;
}

const MOVEMENT_SELECT = `
  SELECT
    m.id AS movement_id,
    m.equipment_id,
    e.equipment_id AS equipment_code,
    e.name AS equipment_name,
    e.current_location_id AS equipment_current_location_id,
    m.moved_by_user_id,
    m.from_location_id,
    from_loc.code AS from_location_code,
    from_loc.name AS from_location_name,
    m.to_location_id,
    to_loc.code AS to_location_code,
    to_loc.name AS to_location_name,
    m.status,
    m.expected_return_at,
    m.moved_at,
    m.returned_at,
    m.returned_by_user_id,
    m.return_location_id,
    m.notes,
    m.reservation_id,
    m.correction_reason,
    m.updated_at
  FROM equipment_movements m
  JOIN equipment e ON e.id = m.equipment_id
  JOIN locations from_loc ON from_loc.id = m.from_location_id
  JOIN locations to_loc ON to_loc.id = m.to_location_id
`;

function isStaff(actor: MovementActor): boolean {
  return actor.role === "technician" || actor.role === "admin";
}

function changes(result: unknown): number {
  const value = (result as { meta?: { changes?: number } } | undefined)?.meta?.changes;
  return typeof value === "number" ? value : Number(value ?? 0);
}

function lastRowId(result: unknown): number {
  const value = (result as { meta?: { last_row_id?: number | string } } | undefined)?.meta?.last_row_id;
  return Number(value ?? 0);
}

function isUniqueOpenMovementError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("idx_equipment_movements_one_open") ||
    message.includes("equipment_movements.equipment_id");
}

function now(): string {
  return new Date().toISOString();
}

function mapMovement(row: MovementRow, returnEvents: MovementReturnEvent[] = []): MovementRecord {
  return {
    id: Number(row.movement_id),
    equipmentId: Number(row.equipment_id),
    equipmentCode: row.equipment_code,
    equipmentName: row.equipment_name,
    equipmentCurrentLocationId: Number(row.equipment_current_location_id),
    movedByUserId: Number(row.moved_by_user_id),
    fromLocationId: Number(row.from_location_id),
    fromLocationCode: row.from_location_code,
    fromLocationName: row.from_location_name,
    toLocationId: Number(row.to_location_id),
    toLocationCode: row.to_location_code,
    toLocationName: row.to_location_name,
    status: row.status,
    expectedReturnAt: row.expected_return_at,
    movedAt: row.moved_at,
    returnedAt: row.returned_at,
    returnedByUserId: row.returned_by_user_id === null ? null : Number(row.returned_by_user_id),
    returnLocationId: row.return_location_id === null ? null : Number(row.return_location_id),
    notes: row.notes,
    reservationId: row.reservation_id === null ? null : Number(row.reservation_id),
    correctionReason: row.correction_reason,
    updatedAt: row.updated_at,
    returnEvents,
  };
}

async function findMovement(client: D1Database, movementId: number): Promise<MovementRecord | null> {
  const row = await client.prepare(`${MOVEMENT_SELECT} WHERE m.id = ? LIMIT 1`)
    .bind(movementId)
    .first<MovementRow>();
  if (!row) return null;

  const events = await client.prepare(`
    SELECT id, movement_id, actor_user_id, from_location_id, to_location_id,
           event_type, notes, created_at
    FROM movement_return_events
    WHERE movement_id = ?
    ORDER BY created_at ASC, id ASC
  `).bind(movementId).all<EventRow>();

  return mapMovement(row, events.results.map((event) => ({
    id: Number(event.id),
    movementId: Number(event.movement_id),
    actorUserId: Number(event.actor_user_id),
    fromLocationId: Number(event.from_location_id),
    toLocationId: Number(event.to_location_id),
    eventType: event.event_type,
    notes: event.notes,
    createdAt: event.created_at,
  })));
}

export async function getMovementOrThrow(client: D1Database, movementId: number): Promise<MovementRecord> {
  const movement = await findMovement(client, movementId);
  if (!movement) throw new MovementError("Movement not found.", 404, "MOVEMENT_NOT_FOUND");
  return movement;
}

async function requireLocation(client: D1Database, locationId: number): Promise<LocationRow> {
  const location = await client.prepare(
    "SELECT id, code, name, type FROM locations WHERE id = ? LIMIT 1",
  ).bind(locationId).first<LocationRow>();
  if (!location) {
    throw new MovementError("Specified location does not exist.", 404, "LOCATION_NOT_FOUND");
  }
  return location;
}

export async function createMovement(
  client: D1Database,
  input: CreateMovementInput,
): Promise<MovementRecord> {
  if (typeof input.equipmentId !== "number" || !Number.isSafeInteger(input.equipmentId) || input.equipmentId <= 0) {
    throw new MovementError("Equipment id must be a positive integer.", 400, "INVALID_EQUIPMENT_ID");
  }
  // Library callers receive the same validation as HTTP callers.
  input = { ...input, ...parseCreateMovementBody(input) };
  await requireActiveMovementActor(client, input.actor);
  const equipment = await client.prepare(
    "SELECT id, equipment_id, name, current_location_id, status, archived FROM equipment WHERE id = ? LIMIT 1",
  ).bind(input.equipmentId).first<EquipmentRow>();
  if (!equipment) {
    throw new MovementError("Equipment item not found.", 404, "EQUIPMENT_NOT_FOUND");
  }
  if (equipment.archived) {
    throw new MovementError("Archived equipment cannot be moved.", 409, "EQUIPMENT_ARCHIVED");
  }

  const sourceLocation = await requireLocation(client, equipment.current_location_id);
  if (input.fromLocationId !== undefined && input.fromLocationId !== equipment.current_location_id) {
    throw new MovementError(
      "fromLocationId must match the equipment's current location.",
      409,
      "STALE_EQUIPMENT_LOCATION",
      { currentLocationId: equipment.current_location_id },
    );
  }
  if (input.toLocationId === equipment.current_location_id) {
    throw new MovementError("Equipment is already at the requested location.", 400, "SAME_LOCATION");
  }
  await requireLocation(client, input.toLocationId);

  const openMovement = await client.prepare(
    "SELECT id FROM equipment_movements WHERE equipment_id = ? AND status = 'open' LIMIT 1",
  ).bind(input.equipmentId).first<{ id: number }>();
  if (openMovement) {
    throw new MovementError(
      "This equipment already has an open movement.",
      409,
      "OPEN_MOVEMENT_EXISTS",
      { movementId: Number(openMovement.id) },
    );
  }

  if (input.actor.role === "student") await assertStudentMovementAllowed(client, input);

  const movedAt = now();
  let results;
  try {
    const hasEndDate = await supportsBookingEndDate(client);
    const sessionGuard = studentMovementSessionGuardFor(hasEndDate);
    const returnGuard = studentMovementReturnGuardFor(hasEndDate);
    results = await client.batch([
      client.prepare(`
        UPDATE equipment
        SET current_location_id = ?,
            status = CASE WHEN status = 'ready' THEN 'away' ELSE status END
        WHERE id = ?
          AND current_location_id = ?
          AND archived = 0
          AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = ? AND is_active = 1)
           ${input.actor.role === "student" ? `AND ${sessionGuard} AND ${studentMovementDesignationGuard} AND ${returnGuard}` : ""}
          AND NOT EXISTS (
            SELECT 1 FROM equipment_movements
            WHERE equipment_id = ? AND status = 'open'
          )
      `).bind(
        input.toLocationId,
        input.equipmentId,
        equipment.current_location_id,
        input.actor.userId,
        input.actor.role,
        ...(input.actor.role === "student" ? [input.bookingId!, input.actor.userId, input.toLocationId, input.expectedReturnAt!, input.expectedReturnAt!, input.bookingId!] : []),
        input.equipmentId,
      ),
      client.prepare(`
        INSERT INTO equipment_movements (
          equipment_id, moved_by_user_id, from_location_id, to_location_id,
          status, expected_return_at, moved_at, notes, reservation_id, updated_at
        )
        SELECT ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?
        FROM equipment
        WHERE id = ? AND current_location_id = ? AND changes() = 1
      `).bind(
        input.equipmentId,
        input.actor.userId,
        sourceLocation.id,
        input.toLocationId,
        input.expectedReturnAt ?? null,
        movedAt,
        input.notes ?? null,
        input.bookingId ?? null,
        movedAt,
        input.equipmentId,
        input.toLocationId,
      ),
    ]);
  } catch (error) {
    if (isUniqueOpenMovementError(error)) {
      throw new MovementError(
        "This equipment already has an open movement.",
        409,
        "OPEN_MOVEMENT_EXISTS",
      );
    }
    throw error;
  }

  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    throw new MovementError(
      "Equipment changed before the movement was recorded. Please retry.",
      409,
      "MOVEMENT_CONFLICT",
    );
  }

  const movementId = lastRowId(results[1]);
  if (!Number.isSafeInteger(movementId) || movementId <= 0) {
    throw new Error("The movement was recorded without a retrievable id.");
  }
  return getMovementOrThrow(client, movementId);
}

export async function listMovements(
  client: D1Database,
  actor: MovementActor,
  options: { mine: boolean; limit: number; offset: number },
): Promise<MovementRecord[]> {
  const scope = options.mine || !isStaff(actor)
    ? "m.moved_by_user_id = ?"
    : "1 = 1";
  const bindings = options.mine || !isStaff(actor)
    ? [actor.userId, options.limit, options.offset]
    : [options.limit, options.offset];
  const result = await client.prepare(`
    ${MOVEMENT_SELECT}
    WHERE ${scope}
    ORDER BY m.moved_at DESC, m.id DESC
    LIMIT ? OFFSET ?
  `).bind(...bindings).all<MovementRow>();

  if (result.results.length === 0) return [];
  const eventRows = await client.prepare(`
    SELECT id, movement_id, actor_user_id, from_location_id, to_location_id,
           event_type, notes, created_at
    FROM movement_return_events
    WHERE movement_id IN (${result.results.map(() => "?").join(", ")})
    ORDER BY created_at ASC, id ASC
  `).bind(...result.results.map((row) => row.movement_id)).all<EventRow>();
  const eventsByMovement = new Map<number, MovementReturnEvent[]>();
  for (const event of eventRows.results) {
    const movementEvent: MovementReturnEvent = {
      id: Number(event.id),
      movementId: Number(event.movement_id),
      actorUserId: Number(event.actor_user_id),
      fromLocationId: Number(event.from_location_id),
      toLocationId: Number(event.to_location_id),
      eventType: event.event_type,
      notes: event.notes,
      createdAt: event.created_at,
    };
    const events = eventsByMovement.get(movementEvent.movementId) ?? [];
    events.push(movementEvent);
    eventsByMovement.set(movementEvent.movementId, events);
  }

  return result.results.map((row) => mapMovement(row, eventsByMovement.get(Number(row.movement_id)) ?? []));
}

export async function returnMovement(
  client: D1Database,
  input: ReturnMovementInput,
): Promise<MovementRecord> {
  const movement = await getMovementOrThrow(client, input.movementId);
  if (movement.status !== "open") {
    throw new MovementError("This movement has already been closed.", 409, "MOVEMENT_ALREADY_CLOSED");
  }
  if (movement.movedByUserId !== input.actor.userId && !isStaff(input.actor)) {
    throw new MovementError("You do not have permission to return this movement.", 403, "MOVEMENT_FORBIDDEN");
  }

  const returnLocationId = input.returnLocationId ?? movement.fromLocationId;
  await requireLocation(client, returnLocationId);
  if (returnLocationId !== movement.fromLocationId) {
    throw new MovementError(
      "A normal return must go back to the movement's original location; use staff correction for another location.",
      400,
      "INVALID_RETURN_LOCATION",
    );
  }

  const returnedAt = now();
  let results;
  try {
    results = await client.batch([
      client.prepare(`
        UPDATE equipment
        SET current_location_id = ?,
            status = CASE WHEN status = 'away' THEN 'ready' ELSE status END
        WHERE id = ?
          AND current_location_id = ?
          AND EXISTS (
            SELECT 1 FROM equipment_movements m
            WHERE m.id = ?
              AND m.equipment_id = equipment.id
              AND m.status = 'open'
              AND m.to_location_id = equipment.current_location_id
              AND m.updated_at = ?
              AND (m.moved_by_user_id = ? OR ? = 1)
          )
      `).bind(
        returnLocationId,
        movement.equipmentId,
        movement.toLocationId,
        movement.id,
        movement.updatedAt,
        movement.movedByUserId,
        isStaff(input.actor) ? 1 : 0,
      ),
      client.prepare(`
        UPDATE equipment_movements
        SET status = 'returned',
            returned_at = ?,
            returned_by_user_id = ?,
            return_location_id = ?,
            notes = COALESCE(?, notes),
            updated_at = ?
        WHERE id = ? AND status = 'open' AND updated_at = ? AND changes() = 1
      `).bind(
        returnedAt,
        input.actor.userId,
        returnLocationId,
        input.notes ?? null,
        returnedAt,
        movement.id,
        movement.updatedAt,
      ),
      client.prepare(`
        INSERT INTO movement_return_events (
          movement_id, actor_user_id, from_location_id, to_location_id,
          event_type, notes, created_at
        )
        SELECT ?, ?, ?, ?, 'return', ?, ?
        WHERE changes() = 1
      `).bind(
        movement.id,
        input.actor.userId,
        movement.toLocationId,
        returnLocationId,
        input.notes ?? null,
        returnedAt,
      ),
    ]);
  } catch (error) {
    if (isUniqueOpenMovementError(error)) {
      throw new MovementError("The movement changed before it could be returned.", 409, "MOVEMENT_CONFLICT");
    }
    throw error;
  }

  if (changes(results[0]) !== 1 || changes(results[1]) !== 1 || changes(results[2]) !== 1) {
    throw new MovementError(
      "Movement changed before the return was recorded. Please reload and retry.",
      409,
      "MOVEMENT_CONFLICT",
    );
  }
  return getMovementOrThrow(client, movement.id);
}

export async function correctMovement(
  client: D1Database,
  input: CorrectMovementInput,
): Promise<MovementRecord> {
  if (!isStaff(input.actor)) {
    throw new MovementError("Only technicians and administrators can correct movements.", 403, "MOVEMENT_FORBIDDEN");
  }
  const movement = await getMovementOrThrow(client, input.movementId);
  const currentEquipment = await client.prepare(
    "SELECT current_location_id FROM equipment WHERE id = ? LIMIT 1",
  ).bind(movement.equipmentId).first<{ current_location_id: number }>();
  if (!currentEquipment) {
    throw new MovementError("Equipment item not found.", 404, "EQUIPMENT_NOT_FOUND");
  }
  await requireLocation(client, input.locationId);

  const correctedAt = now();
  let results;
  try {
    results = await client.batch([
      client.prepare(`
        UPDATE equipment
        SET current_location_id = ?
        WHERE id = ?
          AND current_location_id = ?
          AND EXISTS (
            SELECT 1 FROM equipment_movements m
            WHERE m.id = ? AND m.equipment_id = equipment.id AND m.updated_at = ?
          )
      `).bind(
        input.locationId,
        movement.equipmentId,
        currentEquipment.current_location_id,
        movement.id,
        movement.updatedAt,
      ),
      client.prepare(`
        UPDATE equipment_movements
        SET status = 'corrected',
            returned_at = COALESCE(returned_at, ?),
            returned_by_user_id = ?,
            return_location_id = ?,
            notes = COALESCE(?, notes),
            correction_reason = ?,
            updated_at = ?
        WHERE id = ? AND updated_at = ? AND changes() = 1
      `).bind(
        correctedAt,
        input.actor.userId,
        input.locationId,
        input.notes ?? null,
        input.reason,
        correctedAt,
        movement.id,
        movement.updatedAt,
      ),
      client.prepare(`
        INSERT INTO movement_return_events (
          movement_id, actor_user_id, from_location_id, to_location_id,
          event_type, notes, created_at
        )
        SELECT ?, ?, ?, ?, 'correction', ?, ?
        WHERE changes() = 1
      `).bind(
        movement.id,
        input.actor.userId,
        currentEquipment.current_location_id,
        input.locationId,
        input.reason,
        correctedAt,
      ),
    ]);
  } catch (error) {
    if (isUniqueOpenMovementError(error)) {
      throw new MovementError("The movement changed before it could be corrected.", 409, "MOVEMENT_CONFLICT");
    }
    throw error;
  }

  if (changes(results[0]) !== 1 || changes(results[1]) !== 1 || changes(results[2]) !== 1) {
    throw new MovementError(
      "Movement changed before the correction was recorded. Please reload and retry.",
      409,
      "MOVEMENT_CONFLICT",
    );
  }
  return getMovementOrThrow(client, movement.id);
}

export function parseMovementId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new MovementError("Movement id must be a positive integer.", 400, "INVALID_MOVEMENT_ID");
  }
  return id;
}

export function parseEquipmentId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) {
    throw new MovementError("Equipment id must be a positive integer.", 400, "INVALID_EQUIPMENT_ID");
  }
  return id;
}

function parseOptionalLocationId(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const id = typeof value === "number" ? value : typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new MovementError(`${fieldName} must be a positive integer.`, 400, "INVALID_MOVEMENT_INPUT");
  }
  return id;
}

function parseNotes(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value === null ? null : undefined;
  if (typeof value !== "string") {
    throw new MovementError("notes must be a string.", 400, "INVALID_MOVEMENT_INPUT");
  }
  const notes = value.trim();
  if (notes.length > 1000) {
    throw new MovementError("notes must be 1000 characters or fewer.", 400, "INVALID_MOVEMENT_INPUT");
  }
  return notes || null;
}

function parseExpectedReturnAt(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return value === null ? null : undefined;
  const match = typeof value === "string" && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/.exec(value);
  if (!match || typeof value !== "string") {
    throw new MovementError("expectedReturnAt must be an ISO 8601 UTC timestamp.", 400, "INVALID_MOVEMENT_INPUT");
  }
  const timestamp = Date.parse(value);
  const normalized = `${match[1]}:${match[2] ?? "00"}.${(match[3] ?? "").padEnd(3, "0")}Z`;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== normalized) {
    throw new MovementError("expectedReturnAt must be a valid timestamp.", 400, "INVALID_MOVEMENT_INPUT");
  }
  return value;
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MovementError("Request body must be a JSON object.", 400, "INVALID_MOVEMENT_INPUT");
  }
  return body as Record<string, unknown>;
}

export function parseCreateMovementBody(body: unknown): Omit<CreateMovementInput, "actor" | "equipmentId"> {
  const value = objectBody(body);
  const toLocationId = parseOptionalLocationId(
    value.toLocationId ?? value.destinationLocationId,
    "toLocationId",
  );
  if (!toLocationId) {
    throw new MovementError("toLocationId is required.", 400, "INVALID_MOVEMENT_INPUT");
  }
  return {
    toLocationId,
    fromLocationId: parseOptionalLocationId(value.fromLocationId, "fromLocationId"),
    expectedReturnAt: parseExpectedReturnAt(value.expectedReturnAt),
    notes: parseNotes(value.notes),
    bookingId: parseOptionalLocationId(value.bookingId, "bookingId"),
  };
}

export function parseReturnMovementBody(body: unknown): Pick<ReturnMovementInput, "returnLocationId" | "notes"> {
  const value = objectBody(body);
  return {
    returnLocationId: parseOptionalLocationId(
      value.returnLocationId ?? value.locationId,
      "returnLocationId",
    ),
    notes: parseNotes(value.notes),
  };
}

export function parseCorrectionBody(body: unknown): Pick<CorrectMovementInput, "locationId" | "reason" | "notes"> {
  const value = objectBody(body);
  const locationId = parseOptionalLocationId(
    value.locationId ?? value.currentLocationId ?? value.returnLocationId,
    "locationId",
  );
  if (!locationId) {
    throw new MovementError("locationId is required.", 400, "INVALID_MOVEMENT_INPUT");
  }
  if (typeof value.reason !== "string" || value.reason.trim().length < 3) {
    throw new MovementError("reason must be at least 3 characters.", 400, "INVALID_MOVEMENT_INPUT");
  }
  const reason = value.reason.trim();
  if (reason.length > 500) {
    throw new MovementError("reason must be 500 characters or fewer.", 400, "INVALID_MOVEMENT_INPUT");
  }
  return { locationId, reason, notes: parseNotes(value.notes) };
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new MovementError("Request body must contain valid JSON.", 400, "INVALID_JSON");
  }
}

export function movementErrorResponse(error: unknown): Response {
  if (error instanceof MovementError || error instanceof MovementPermissionError) {
    return Response.json(
      { error: error.message, code: error.code, ...(error instanceof MovementError && error.details ? { details: error.details } : {}) },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return Response.json({ error: message }, { status: 500 });
}
