import type { BookingActor } from "./booking-lifecycle.ts";
import { requireStaff, RoomReadinessError } from "./room-readiness.ts";

export type RepairStage = "reported" | "assessing" | "awaiting_parts" | "in_repair" | "awaiting_inspection" | "completed";
const stages: RepairStage[] = ["reported", "assessing", "awaiting_parts", "in_repair", "awaiting_inspection", "completed"];

function parseNullableTimestamp(value: unknown, label: string, preserveUndefined = false): string | null | undefined {
  if (value === undefined) return preserveUndefined ? undefined : null;
  if (value === null || value === "") return null;
  const parts = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value) : null;
  const year = Number(parts?.[1]);
  const month = Number(parts?.[2]);
  const day = Number(parts?.[3]);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!parts || year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || !Number.isFinite(Date.parse(value as string))) {
    throw new RoomReadinessError(`${label} must be a valid ISO timestamp with a timezone, or null.`, 400, "REPAIR_TIMESTAMP_INVALID");
  }
  return new Date(value as string).toISOString();
}

function positiveId(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new RoomReadinessError(`${label} must be a positive integer.`, 400, "ID_INVALID");
  return value;
}

function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length > 4000) throw new RoomReadinessError(`${label} must be text of at most 4,000 characters.`, 400, "REPAIR_TEXT_INVALID");
  return value.trim() || null;
}

function inspectionCondition(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 500) throw new RoomReadinessError("Inspection condition must contain 1–500 characters.", 400, "INSPECTION_INVALID");
  return value.trim();
}

const activeStaff = "EXISTS (SELECT 1 FROM users WHERE id = ? AND is_active = 1 AND role IN ('technician', 'admin'))";
const readyOrAway = `CASE WHEN default_location_id IS NOT NULL AND current_location_id = default_location_id
  AND NOT EXISTS (SELECT 1 FROM equipment_movements m WHERE m.equipment_id = equipment.id AND m.status = 'open')
  THEN 'ready' ELSE 'away' END`;

// IDs order observations even when two inspections have identical timestamps or a later failure was backdated.
// This predicate is used both for the useful pre-read error and inside the serialized completion UPDATE.
const completionInspection = `EXISTS (SELECT 1 FROM equipment_inspections i
  WHERE i.id = ? AND i.equipment_id = j.equipment_id AND i.repair_job_id = j.id AND i.result = 'passed'
    AND length(trim(i.condition)) BETWEEN 1 AND 500
    AND i.id = (SELECT max(latest.id) FROM equipment_inspections latest WHERE latest.equipment_id = j.equipment_id)
    AND julianday(i.observed_at) >= julianday(j.opened_at) AND julianday(i.observed_at) <= julianday(?))`;

type Inspection = {
  id: number; equipmentId: number; inspectorUserId: number; result: "passed" | "failed";
  condition: string; notes: string | null; observedAt: string; repairJobId: number | null;
};

async function readWrittenRepair(db: D1Database, equipmentId: number, repairId: number) {
  const repair = (await listRepairs(db, equipmentId)).find((item) => item.id === repairId);
  if (!repair) throw new RoomReadinessError("Repair could not be read after writing.", 500, "REPAIR_WRITE_FAILED");
  return repair;
}

export async function listRepairs(db: D1Database, equipmentId: number) {
  const rows = await db.prepare(`
    SELECT j.id, j.equipment_id AS equipmentId, j.stage, j.expected_return_at AS expectedReturnAt,
      j.opened_at AS openedAt, j.completed_at AS completedAt,
      u.stage AS latestStage, u.public_message AS latestPublicMessage, u.created_at AS latestUpdatedAt
    FROM repair_jobs j
    LEFT JOIN repair_updates u ON u.id = (
      SELECT latest.id FROM repair_updates latest WHERE latest.repair_job_id = j.id ORDER BY latest.id DESC LIMIT 1
    )
    WHERE j.equipment_id = ?
    ORDER BY j.id DESC
  `).bind(equipmentId).all<{
    id: number; equipmentId: number; stage: RepairStage; expectedReturnAt: string | null; openedAt: string; completedAt: string | null;
    latestStage: RepairStage | null; latestPublicMessage: string | null; latestUpdatedAt: string | null;
  }>();
  const now = Date.now();
  return rows.results.map((repair) => ({
    ...repair,
    overdue: Boolean(repair.expectedReturnAt && Date.parse(repair.expectedReturnAt) < now && repair.stage !== "completed"),
  }));
}

export async function createRepair(
  db: D1Database,
  input: { equipmentId: number; actor: BookingActor; expectedReturnAt?: unknown; sourceReportId?: number; publicMessage?: string; privateNote?: string },
) {
  requireStaff(input.actor);
  positiveId(input.equipmentId, "Equipment id");
  const expectedReturnAt = parseNullableTimestamp(input.expectedReturnAt, "expectedReturnAt");
  const publicMessage = optionalText(input.publicMessage, "Public message");
  const privateNote = optionalText(input.privateNote, "Private note");
  if (input.sourceReportId !== undefined) positiveId(input.sourceReportId, "Source report id");
  const equipment = await db.prepare("SELECT id, archived FROM equipment WHERE id = ? LIMIT 1").bind(input.equipmentId).first<{ id: number; archived: number }>();
  if (!equipment) throw new RoomReadinessError("Equipment item not found.", 404, "EQUIPMENT_NOT_FOUND");
  if (equipment.archived) throw new RoomReadinessError("Archived equipment cannot start a repair.", 409, "EQUIPMENT_ARCHIVED");
  const existing = await db.prepare("SELECT id FROM repair_jobs WHERE equipment_id = ? AND stage <> 'completed' LIMIT 1").bind(input.equipmentId).first<{ id: number }>();
  if (existing) throw new RoomReadinessError("This equipment already has an open repair job.", 409, "REPAIR_ALREADY_OPEN");
  if (input.sourceReportId !== undefined && !await db.prepare("SELECT id FROM reports WHERE id = ? AND equipment_id = ? AND category = 'equipment'").bind(input.sourceReportId, input.equipmentId).first()) {
    throw new RoomReadinessError("Source report must be an equipment report for this equipment.", 400, "REPAIR_REPORT_INVALID");
  }
  const now = new Date().toISOString();
  const [result] = await db.batch<{ id: number }>([
    db.prepare(`
      INSERT INTO repair_jobs (equipment_id, source_report_id, stage, expected_return_at, opened_by_user_id, opened_at)
      SELECT e.id, ?, 'reported', ?, ?, ? FROM equipment e
      WHERE e.id = ? AND e.archived = 0 AND ${activeStaff}
        AND NOT EXISTS (SELECT 1 FROM repair_jobs WHERE equipment_id = e.id AND stage <> 'completed')
        ${input.sourceReportId === undefined ? "" : "AND EXISTS (SELECT 1 FROM reports WHERE id = ? AND equipment_id = e.id AND category = 'equipment')"}
      RETURNING id
    `).bind(input.sourceReportId ?? null, expectedReturnAt ?? null, input.actor.userId, now, input.equipmentId, input.actor.userId, ...(input.sourceReportId === undefined ? [] : [input.sourceReportId])),
    // last_insert_rowid() is the job from the immediately preceding statement, never a post-commit lookup.
    db.prepare(`INSERT INTO repair_updates (repair_job_id, stage, expected_return_at, public_message, private_note, actor_user_id, created_at)
      SELECT last_insert_rowid(), 'reported', ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(expectedReturnAt ?? null, publicMessage, privateNote, input.actor.userId, now),
    db.prepare("UPDATE equipment SET status = 'service' WHERE id = ? AND changes() = 1").bind(input.equipmentId),
    db.prepare(`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details, created_at)
      SELECT ?, 'created', 'repair', CAST((SELECT repair_job_id FROM repair_updates WHERE id = last_insert_rowid()) AS TEXT), ?,
        json_object('equipmentId', ?, 'sourceReportId', ?, 'stage', 'reported', 'expectedReturnAt', ?), ? WHERE changes() = 1`)
      .bind(input.actor.userId, publicMessage ?? "Repair opened.", input.equipmentId, input.sourceReportId ?? null, expectedReturnAt ?? null, now),
  ]);
  if (!result.results[0]) throw new RoomReadinessError("Equipment changed or already has an open repair. Refresh before retrying.", 409, "REPAIR_ALREADY_OPEN");
  return readWrittenRepair(db, input.equipmentId, result.results[0].id);
}

export async function recordInspection(
  db: D1Database,
  input: { equipmentId: number; actor: BookingActor; result: "passed" | "failed"; condition: string; notes?: string; repairJobId?: number },
) {
  requireStaff(input.actor);
  positiveId(input.equipmentId, "Equipment id");
  if (input.result !== "passed" && input.result !== "failed") throw new RoomReadinessError("Inspection result must be passed or failed.", 400, "INSPECTION_INVALID");
  const condition = inspectionCondition(input.condition);
  const notes = optionalText(input.notes, "Inspection notes");
  if (input.repairJobId !== undefined) positiveId(input.repairJobId, "Repair job id");
  const equipment = await db.prepare("SELECT id FROM equipment WHERE id = ? LIMIT 1").bind(input.equipmentId).first<{ id: number }>();
  if (!equipment) throw new RoomReadinessError("Equipment item not found.", 404, "EQUIPMENT_NOT_FOUND");
  if (input.repairJobId !== undefined) {
    const job = await db.prepare("SELECT id, equipment_id AS equipmentId, stage FROM repair_jobs WHERE id = ? LIMIT 1").bind(input.repairJobId).first<{ id: number; equipmentId: number; stage: RepairStage }>();
    if (!job || job.equipmentId !== input.equipmentId) throw new RoomReadinessError("Repair job does not belong to this equipment.", 400, "REPAIR_EQUIPMENT_MISMATCH");
    if (job.stage === "completed") throw new RoomReadinessError("Completed repairs cannot receive new inspections; record a standalone inspection or open a new job.", 409, "REPAIR_COMPLETED");
  }
  const observedAt = new Date().toISOString();
  const [result] = await db.batch<Inspection>([
    db.prepare(`INSERT INTO equipment_inspections (equipment_id, inspector_user_id, result, condition, notes, observed_at, repair_job_id)
      SELECT e.id, ?, ?, ?, ?, ?, ? FROM equipment e WHERE e.id = ? AND ${activeStaff}
        ${input.repairJobId === undefined ? "" : "AND EXISTS (SELECT 1 FROM repair_jobs j WHERE j.id = ? AND j.equipment_id = e.id AND j.stage <> 'completed')"}
      RETURNING id, equipment_id AS equipmentId, inspector_user_id AS inspectorUserId, result, condition, notes, observed_at AS observedAt, repair_job_id AS repairJobId`)
      .bind(input.actor.userId, input.result, condition, notes, observedAt, input.repairJobId ?? null, input.equipmentId, input.actor.userId, ...(input.repairJobId === undefined ? [] : [input.repairJobId])),
    db.prepare(`UPDATE equipment SET condition = ?, last_inspected_at = ?, status = CASE
        WHEN ? = 'failed' THEN 'attention'
        WHEN EXISTS (SELECT 1 FROM repair_jobs j WHERE j.equipment_id = equipment.id AND j.stage <> 'completed') THEN 'service'
        ELSE ${readyOrAway} END
      WHERE id = ? AND changes() = 1`)
      .bind(condition, observedAt, input.result, input.equipmentId),
    db.prepare(`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details, created_at)
      SELECT ?, 'recorded', 'equipment_inspection', CAST(last_insert_rowid() AS TEXT), ?,
        json_object('equipmentId', ?, 'repairJobId', ?, 'result', ?, 'condition', ?, 'observedAt', ?,
          'equipmentStatus', (SELECT status FROM equipment WHERE id = ?)), ? WHERE changes() = 1`)
      .bind(input.actor.userId, notes ?? `Inspection ${input.result}.`, input.equipmentId, input.repairJobId ?? null, input.result, condition, observedAt, input.equipmentId, observedAt),
  ]);
  if (!result.results[0]) throw new RoomReadinessError("Equipment or repair changed before the inspection was recorded. Refresh and retry.", 409, "INSPECTION_CONFLICT");
  return result.results[0];
}

export async function updateRepair(
  db: D1Database,
  input: { repairId: number; actor: BookingActor; stage: RepairStage; expectedReturnAt?: unknown; publicMessage?: string; privateNote?: string; inspectionId?: number },
) {
  requireStaff(input.actor);
  positiveId(input.repairId, "Repair id");
  if (!stages.includes(input.stage)) throw new RoomReadinessError("Unknown repair stage.", 400, "REPAIR_STAGE_INVALID");
  const expectedReturnAt = parseNullableTimestamp(input.expectedReturnAt, "expectedReturnAt", true);
  const publicMessage = optionalText(input.publicMessage, "Public message");
  const privateNote = optionalText(input.privateNote, "Private note");
  const repair = await db.prepare(`SELECT id, equipment_id AS equipmentId, stage AS currentStage, expected_return_at AS currentExpectedReturnAt,
    COALESCE((SELECT max(id) FROM repair_updates WHERE repair_job_id = j.id), 0) AS historyVersion
    FROM repair_jobs j WHERE id = ? LIMIT 1`).bind(input.repairId).first<{ id: number; equipmentId: number; currentStage: RepairStage; currentExpectedReturnAt: string | null; historyVersion: number }>();
  if (!repair) throw new RoomReadinessError("Repair job not found.", 404, "REPAIR_NOT_FOUND");
  if (repair.currentStage === "completed") throw new RoomReadinessError("Completed repairs are immutable; open a new job if needed.", 409, "REPAIR_COMPLETED");
  if (stages.indexOf(input.stage) < stages.indexOf(repair.currentStage)) throw new RoomReadinessError("Repair stages cannot move backwards.", 409, "REPAIR_STAGE_REGRESSION");
  const nextExpected = expectedReturnAt === undefined ? repair.currentExpectedReturnAt : expectedReturnAt;
  const completing = input.stage === "completed";
  const now = new Date().toISOString();
  if (completing) {
    if (!input.inspectionId || !Number.isSafeInteger(input.inspectionId) || input.inspectionId <= 0) throw new RoomReadinessError("A passed inspection is required before completing a repair.", 422, "REPAIR_INSPECTION_REQUIRED");
    if (!await db.prepare(`SELECT id FROM repair_jobs j WHERE j.id = ? AND ${completionInspection}`).bind(input.repairId, input.inspectionId, now).first()) {
      throw new RoomReadinessError("Completion requires the latest equipment inspection to pass, belong to this repair, and be observed after the repair opened.", 422, "REPAIR_INSPECTION_INVALID");
    }
  }
  const [result] = await db.batch<{ id: number }>([
    db.prepare(`
      UPDATE repair_jobs AS j SET stage = ?, expected_return_at = ?, completed_at = ?, completed_by_user_id = ?, completion_inspection_id = ?
      WHERE j.id = ? AND j.stage = ? AND j.stage <> 'completed' AND j.expected_return_at IS ? AND ${activeStaff}
        AND COALESCE((SELECT max(id) FROM repair_updates WHERE repair_job_id = j.id), 0) = ?
        ${completing ? `AND ${completionInspection}` : ""}
      RETURNING id
    `).bind(input.stage, nextExpected ?? null, completing ? now : null, completing ? input.actor.userId : null, completing ? input.inspectionId! : null,
      input.repairId, repair.currentStage, repair.currentExpectedReturnAt, input.actor.userId, repair.historyVersion, ...(completing ? [input.inspectionId!, now] : [])),
    db.prepare(`
      INSERT INTO repair_updates (repair_job_id, stage, expected_return_at, public_message, private_note, actor_user_id, created_at)
      SELECT id, stage, expected_return_at, ?, ?, ?, ? FROM repair_jobs WHERE id = ? AND changes() = 1
    `).bind(publicMessage, privateNote, input.actor.userId, now, input.repairId),
    db.prepare(`UPDATE equipment SET status = CASE
        WHEN EXISTS (SELECT 1 FROM repair_jobs WHERE equipment_id = equipment.id AND stage <> 'completed') THEN 'service'
        ELSE ${readyOrAway} END,
      condition = ${completing ? "(SELECT condition FROM equipment_inspections WHERE id = ?)" : "condition"},
      last_inspected_at = ${completing ? "(SELECT observed_at FROM equipment_inspections WHERE id = ?)" : "last_inspected_at"}
      WHERE id = ? AND changes() = 1`)
      .bind(...(completing ? [input.inspectionId!, input.inspectionId!] : []), repair.equipmentId),
    db.prepare(`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details, created_at)
      SELECT ?, ?, 'repair', ?, ?, json_object('equipmentId', ?, 'previousStage', ?, 'stage', ?, 'expectedReturnAt', ?, 'inspectionId', ?,
        'equipmentStatus', (SELECT status FROM equipment WHERE id = ?)), ? WHERE changes() = 1`)
      .bind(input.actor.userId, completing ? "completed" : "updated", String(input.repairId), publicMessage ?? `Repair ${input.stage}.`, repair.equipmentId,
        repair.currentStage, input.stage, nextExpected ?? null, completing ? input.inspectionId! : null, repair.equipmentId, now),
    ...(completing ? [
      db.prepare(`UPDATE reports SET status = 'resolved', updated_at = ?, resolved_at = ?
        WHERE id = (SELECT source_report_id FROM repair_jobs WHERE id = ?) AND changes() = 1
          AND status IN ('open', 'acknowledged', 'in_progress', 'reopened')`).bind(now, now, input.repairId),
      db.prepare(`INSERT INTO report_updates (report_id, author_id, status, message, created_at)
        SELECT source_report_id, ?, 'resolved', ?, ? FROM repair_jobs WHERE id = ? AND changes() = 1`)
        .bind(input.actor.userId, publicMessage ?? `Repair #${input.repairId} completed after a passed inspection.`, now, input.repairId),
      db.prepare(`INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details, created_at)
        SELECT ?, 'resolved', 'report', CAST(source_report_id AS TEXT), ?, json_object('repairId', id, 'inspectionId', ?), ?
        FROM repair_jobs WHERE id = ? AND changes() = 1`)
        .bind(input.actor.userId, `Linked repair #${input.repairId} completed.`, input.inspectionId!, now, input.repairId),
    ] : []),
  ]);
  if (!result.results[0]) throw new RoomReadinessError("Repair changed or the completion inspection is no longer current. Refresh and retry.", 409, "REPAIR_CONFLICT");
  return readWrittenRepair(db, repair.equipmentId, input.repairId);
}
