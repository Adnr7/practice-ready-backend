import type { BookingActor } from "./booking-lifecycle.ts";
import { requireStaff, RoomReadinessError } from "./room-readiness.ts";

export type RepairStage = "reported" | "assessing" | "awaiting_parts" | "in_repair" | "awaiting_inspection" | "completed";
const stages: RepairStage[] = ["reported", "assessing", "awaiting_parts", "in_repair", "awaiting_inspection", "completed"];

function parseNullableTimestamp(value: unknown, label: string, preserveUndefined = false): string | null | undefined {
  if (value === undefined && preserveUndefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new RoomReadinessError(`${label} must be a valid ISO timestamp or null.`, 400, "REPAIR_TIMESTAMP_INVALID");
  return new Date(value).toISOString();
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
  const equipment = await db.prepare("SELECT id FROM equipment WHERE id = ? LIMIT 1").bind(input.equipmentId).first<{ id: number }>();
  if (!equipment) throw new RoomReadinessError("Equipment item not found.", 404, "EQUIPMENT_NOT_FOUND");
  const existing = await db.prepare("SELECT id FROM repair_jobs WHERE equipment_id = ? AND stage <> 'completed' LIMIT 1").bind(input.equipmentId).first<{ id: number }>();
  if (existing) throw new RoomReadinessError("This equipment already has an open repair job.", 409, "REPAIR_ALREADY_OPEN");
  const expectedReturnAt = parseNullableTimestamp(input.expectedReturnAt, "expectedReturnAt");
  await db.batch([
    db.prepare(`
      INSERT INTO repair_jobs (equipment_id, source_report_id, stage, expected_return_at, opened_by_user_id)
      VALUES (?, ?, 'reported', ?, ?)
    `).bind(input.equipmentId, input.sourceReportId ?? null, expectedReturnAt ?? null, input.actor.userId),
    db.prepare("UPDATE equipment SET status = 'service' WHERE id = ?").bind(input.equipmentId),
  ]);
  const job = await db.prepare("SELECT id FROM repair_jobs WHERE equipment_id = ? AND stage <> 'completed' ORDER BY id DESC LIMIT 1").bind(input.equipmentId).first<{ id: number }>();
  if (!job) throw new RoomReadinessError("Repair job was not created.", 500, "REPAIR_WRITE_FAILED");
  await db.prepare(`
    INSERT INTO repair_updates (repair_job_id, stage, expected_return_at, public_message, private_note, actor_user_id)
    VALUES (?, 'reported', ?, ?, ?, ?)
  `).bind(job.id, expectedReturnAt ?? null, input.publicMessage?.trim() || null, input.privateNote?.trim() || null, input.actor.userId).run();
  return (await listRepairs(db, input.equipmentId))[0];
}

export async function recordInspection(
  db: D1Database,
  input: { equipmentId: number; actor: BookingActor; result: "passed" | "failed"; condition: string; notes?: string; repairJobId?: number },
) {
  requireStaff(input.actor);
  if (!input.condition.trim()) throw new RoomReadinessError("Inspection condition is required.", 400, "INSPECTION_INVALID");
  const equipment = await db.prepare("SELECT id FROM equipment WHERE id = ? LIMIT 1").bind(input.equipmentId).first<{ id: number }>();
  if (!equipment) throw new RoomReadinessError("Equipment item not found.", 404, "EQUIPMENT_NOT_FOUND");
  if (input.repairJobId) {
    const job = await db.prepare("SELECT id, equipment_id AS equipmentId FROM repair_jobs WHERE id = ? LIMIT 1").bind(input.repairJobId).first<{ id: number; equipmentId: number }>();
    if (!job || job.equipmentId !== input.equipmentId) throw new RoomReadinessError("Repair job does not belong to this equipment.", 400, "REPAIR_EQUIPMENT_MISMATCH");
  }
  const observedAt = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO equipment_inspections (equipment_id, inspector_user_id, result, condition, notes, observed_at, repair_job_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id, equipment_id AS equipmentId, inspector_user_id AS inspectorUserId, result, condition, notes, observed_at AS observedAt, repair_job_id AS repairJobId
  `).bind(input.equipmentId, input.actor.userId, input.result, input.condition.trim(), input.notes?.trim() || null, observedAt, input.repairJobId ?? null).first<{ id: number; equipmentId: number; inspectorUserId: number; result: string; condition: string; notes: string | null; observedAt: string; repairJobId: number | null }>();
  await db.prepare(`
    UPDATE equipment SET condition = ?, last_inspected_at = ?, status = CASE
      WHEN ? = 'failed' THEN 'attention'
      WHEN EXISTS (SELECT 1 FROM repair_jobs j WHERE j.equipment_id = equipment.id AND j.stage <> 'completed') THEN 'service'
      ELSE 'ready' END
    WHERE id = ?
  `).bind(input.condition.trim(), observedAt, input.result, input.equipmentId).run();
  return result;
}

export async function updateRepair(
  db: D1Database,
  input: { repairId: number; actor: BookingActor; stage: RepairStage; expectedReturnAt?: unknown; publicMessage?: string; privateNote?: string; inspectionId?: number },
) {
  requireStaff(input.actor);
  if (!stages.includes(input.stage)) throw new RoomReadinessError("Unknown repair stage.", 400, "REPAIR_STAGE_INVALID");
  const repair = await db.prepare("SELECT id, equipment_id AS equipmentId, stage AS currentStage, expected_return_at AS currentExpectedReturnAt FROM repair_jobs WHERE id = ? LIMIT 1").bind(input.repairId).first<{ id: number; equipmentId: number; currentStage: RepairStage; currentExpectedReturnAt: string | null }>();
  if (!repair) throw new RoomReadinessError("Repair job not found.", 404, "REPAIR_NOT_FOUND");
  if (repair.currentStage === "completed") throw new RoomReadinessError("Completed repairs are immutable; open a new job if needed.", 409, "REPAIR_COMPLETED");
  if (stages.indexOf(input.stage) < stages.indexOf(repair.currentStage)) throw new RoomReadinessError("Repair stages cannot move backwards.", 409, "REPAIR_STAGE_REGRESSION");
  const expectedReturnAt = parseNullableTimestamp(input.expectedReturnAt, "expectedReturnAt", true);
  const nextExpected = expectedReturnAt === undefined ? repair.currentExpectedReturnAt : expectedReturnAt;
  let inspection: { id: number; condition: string } | null = null;
  if (input.stage === "completed") {
    if (!input.inspectionId || !Number.isSafeInteger(input.inspectionId)) throw new RoomReadinessError("A passed inspection is required before completing a repair.", 422, "REPAIR_INSPECTION_REQUIRED");
    inspection = await db.prepare("SELECT id, condition FROM equipment_inspections WHERE id = ? AND equipment_id = ? AND result = 'passed' LIMIT 1").bind(input.inspectionId, repair.equipmentId).first<{ id: number; condition: string }>();
    if (!inspection) throw new RoomReadinessError("The completion inspection must be a passed inspection for this equipment.", 422, "REPAIR_INSPECTION_INVALID");
  }
  const completedAt = input.stage === "completed" ? new Date().toISOString() : null;
  await db.batch([
    db.prepare(`
      UPDATE repair_jobs SET stage = ?, expected_return_at = ?, completed_at = ?, completed_by_user_id = ?, completion_inspection_id = ?
      WHERE id = ?
    `).bind(input.stage, nextExpected ?? null, completedAt, input.stage === "completed" ? input.actor.userId : null, inspection?.id ?? null, input.repairId),
    db.prepare(`
      INSERT INTO repair_updates (repair_job_id, stage, expected_return_at, public_message, private_note, actor_user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(input.repairId, input.stage, nextExpected ?? null, input.publicMessage?.trim() || null, input.privateNote?.trim() || null, input.actor.userId),
    db.prepare(`
      UPDATE equipment SET status = ?, condition = COALESCE(?, condition), last_inspected_at = COALESCE(?, last_inspected_at)
      WHERE id = ?
    `).bind(input.stage === "completed" ? "ready" : "service", inspection?.condition ?? null, completedAt, repair.equipmentId),
  ]);
  return (await listRepairs(db, repair.equipmentId)).find((item) => item.id === input.repairId) ?? null;
}
