import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { applyMigrationBatch, loadMigrations } from "../scripts/migration-tools.mjs";
import { createRepair, listRepairs, recordInspection, updateRepair } from "../lib/repair-store.ts";

const require = createRequire(import.meta.url);
const { Miniflare } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const actor = { userId: 3, role: "technician" };

describe("Repair lifecycle transaction safety", () => {
  let emulator;
  let db;
  const open = (extra = {}) => createRepair(db, { actor, equipmentId: 1, expectedReturnAt: null, publicMessage: "Assessing the fault", ...extra });
  const inspect = (job, extra = {}) => recordInspection(db, { actor, equipmentId: job.equipmentId, repairJobId: job.id, result: "passed", condition: "Fully functional", ...extra });
  const complete = (job, inspection, target = db) => updateRepair(target, { actor, repairId: job.id, stage: "completed", inspectionId: inspection.id, publicMessage: "Inspected and repaired", privateNote: "Internal supplier details" });
  const count = async (table) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
  const equipment = (equipmentId = 1) => db.prepare("SELECT * FROM equipment WHERE id = ?").bind(equipmentId).first();
  const jobRow = (job) => db.prepare("SELECT * FROM repair_jobs WHERE id = ?").bind(job.id).first();
  const beforeBatch = (operation) => ({ prepare: db.prepare.bind(db), batch: async (statements) => { await operation(); return db.batch(statements); } });
  const report = (reportId = 1, equipmentId = 1, status = "in_progress") => db.prepare(`INSERT INTO reports
    (id, reference, reporter_id, category, equipment_id, description, status, updated_at, resolved_at)
    VALUES (?, ?, 1, 'equipment', ?, 'Equipment fault', ?, '2000-01-01T00:00:00.000Z', ?)`)
    .bind(reportId, `RPT-${reportId}`, equipmentId, status, ["closed", "resolved"].includes(status) ? "2000-01-01T00:00:00.000Z" : null).run();

  before(async () => {
    emulator = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-05-15", d1Databases: ["DB"] });
    db = await emulator.getD1Database("DB");
    for (const migration of await loadMigrations()) await applyMigrationBatch(db, migration);
    await db.batch([
      db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES (1, 'student@example.com', 'hash', 'salt', 'Student', 'student'), (3, 'tech@example.com', 'hash', 'salt', 'Technician', 'technician')"),
      db.prepare("INSERT INTO locations (id, code, name, type) VALUES (1, 'practice', 'Practice room', 'room'), (2, 'store', 'Storage', 'storage')"),
      db.prepare("INSERT INTO equipment (id, equipment_id, name, type, current_location_id, default_location_id) VALUES (1, 'MIX-01', 'Mixer', 'mixer', 1, 1), (2, 'MIC-01', 'Microphone', 'mic', 1, 1)"),
    ]);
  });
  after(async () => emulator?.dispose());
  beforeEach(async () => {
    await db.batch([
      ...["reject_repair_update", "reject_repair_audit", "reject_inspection_equipment", "reject_report_history"].map((trigger) => db.prepare(`DROP TRIGGER IF EXISTS ${trigger}`)),
      ...["audit_events", "report_updates", "repair_updates", "equipment_inspections", "repair_jobs", "reports", "movement_return_events", "equipment_movements"].map((table) => db.prepare(`DELETE FROM ${table}`)),
      db.prepare("UPDATE equipment SET status = 'ready', condition = 'Original condition', last_inspected_at = NULL, current_location_id = 1, default_location_id = 1, archived = 0"),
    ]);
  });

  it("allows omitted ETA, normalizes timestamps, and creates the first update and audit with the job", async () => {
    const job = await createRepair(db, { actor, equipmentId: 1, publicMessage: "Initial public update", privateNote: "Private diagnosis" });
    assert.equal(job.expectedReturnAt, null);
    assert.equal((await equipment()).status, "service");
    const update = await db.prepare("SELECT * FROM repair_updates").first();
    assert.equal(update.repair_job_id, job.id);
    assert.equal(update.public_message, "Initial public update");
    assert.equal(update.private_note, "Private diagnosis");
    const audit = await db.prepare("SELECT * FROM audit_events").first();
    assert.equal(audit.entity_type, "repair");
    assert.equal(audit.entity_id, String(job.id));
    assert.equal(audit.action, "created");
    const changed = await updateRepair(db, { actor, repairId: job.id, stage: "assessing", expectedReturnAt: "2099-01-01T12:00:00+05:30" });
    assert.equal(changed.expectedReturnAt, "2099-01-01T06:30:00.000Z");
    assert.equal((await updateRepair(db, { actor, repairId: job.id, stage: "in_repair" })).expectedReturnAt, changed.expectedReturnAt);
    assert.equal((await updateRepair(db, { actor, repairId: job.id, stage: "awaiting_inspection", expectedReturnAt: null })).expectedReturnAt, null);
  });

  it("creates only one concurrent open job and no orphan first update or audit", async () => {
    let arrived = 0;
    let release;
    const ready = new Promise((resolve) => { release = resolve; });
    const racingDb = { prepare: db.prepare.bind(db), batch: async (statements) => {
      if (++arrived === 2) release();
      await ready;
      return db.batch(statements);
    } };
    const create = () => createRepair(racingDb, { actor, equipmentId: 1 });
    const results = await Promise.allSettled([create(), create()]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.find((result) => result.status === "rejected").reason.code, "REPAIR_ALREADY_OPEN");
    assert.equal(await count("repair_jobs"), 1);
    assert.equal(await count("repair_updates"), 1);
    assert.equal(await count("audit_events"), 1);
    assert.equal((await db.prepare("SELECT repair_job_id AS id FROM repair_updates").first()).id, results.find((result) => result.status === "fulfilled").value.id);
  });

  it("rolls back creation when either the first history write or audit fails", async () => {
    for (const [trigger, table] of [["reject_repair_update", "repair_updates"], ["reject_repair_audit", "audit_events"]]) {
      await db.prepare(`CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'creation write unavailable'); END`).run();
      await assert.rejects(open(), /creation write unavailable/);
      assert.equal(await count("repair_jobs"), 0);
      assert.equal(await count("repair_updates"), 0);
      assert.equal(await count("audit_events"), 0);
      assert.equal((await equipment()).status, "ready");
      await db.prepare(`DROP TRIGGER ${trigger}`).run();
    }
  });

  it("rolls back the inspection and equipment change together on equipment or audit failure", async () => {
    const job = await open();
    const baselineAudit = await count("audit_events");
    for (const [trigger, sql] of [
      ["reject_inspection_equipment", "BEFORE UPDATE ON equipment"],
      ["reject_repair_audit", "BEFORE INSERT ON audit_events"],
    ]) {
      await db.prepare(`CREATE TRIGGER ${trigger} ${sql} BEGIN SELECT RAISE(ABORT, 'inspection write unavailable'); END`).run();
      await assert.rejects(inspect(job, { condition: "New inspected condition" }), /inspection write unavailable/);
      assert.equal(await count("equipment_inspections"), 0);
      assert.equal((await equipment()).condition, "Original condition");
      assert.equal((await equipment()).last_inspected_at, null);
      assert.equal(await count("audit_events"), baselineAudit);
      await db.prepare(`DROP TRIGGER ${trigger}`).run();
    }
    const inspection = await inspect(job);
    const audit = await db.prepare("SELECT * FROM audit_events WHERE entity_type = 'equipment_inspection'").first();
    assert.equal(audit.entity_id, String(inspection.id));
    assert.equal((await equipment()).last_inspected_at, inspection.observedAt);
  });

  it("rejects invalid condition, result, timestamps and identifiers before writing", async () => {
    for (const expectedReturnAt of ["not-a-date", "2099-02-30T09:00:00Z", "2099-01-01", "2099-01-01T09:00:00", 123, {}]) {
      await assert.rejects(open({ expectedReturnAt }), { status: 400, code: "REPAIR_TIMESTAMP_INVALID" });
    }
    for (const extra of [{ result: "unknown" }, { result: null }, { condition: null }, { condition: 7 }, { condition: " " }, { condition: "x".repeat(501) }, { repairJobId: 0 }, { notes: 123 }]) {
      await assert.rejects(recordInspection(db, { actor, equipmentId: 1, result: "passed", condition: "Functional", ...extra }), { status: 400 });
    }
    assert.equal(await count("repair_jobs"), 0);
    assert.equal(await count("equipment_inspections"), 0);
    assert.equal(await count("audit_events"), 0);
  });

  it("rejects historical, wrong-job, unlinked, pre-repair and future inspections", async () => {
    const oldJob = await open();
    const historical = await inspect(oldJob);
    await complete(oldJob, historical);
    const job = await open();
    await assert.rejects(complete(job, historical), { code: "REPAIR_INSPECTION_INVALID" });
    const unlinked = await recordInspection(db, { actor, equipmentId: 1, result: "passed", condition: "Standalone pass" });
    await assert.rejects(complete(job, unlinked), { code: "REPAIR_INSPECTION_INVALID" });
    const current = await inspect(job);
    await db.prepare("UPDATE equipment_inspections SET observed_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(current.id).run();
    await assert.rejects(complete(job, current), { code: "REPAIR_INSPECTION_INVALID" });
    await db.prepare("UPDATE equipment_inspections SET observed_at = '2099-01-01T00:00:00.000Z' WHERE id = ?").bind(current.id).run();
    await assert.rejects(complete(job, current), { code: "REPAIR_INSPECTION_INVALID" });
    assert.equal((await jobRow(job)).stage, "reported");
  });

  it("requires the latest equipment inspection to pass for this job, even when failures share its timestamp", async () => {
    const job = await open();
    const passed = await inspect(job);
    const failed = await inspect(job, { result: "failed", condition: "Still faulty" });
    await db.prepare("UPDATE equipment_inspections SET observed_at = ? WHERE id = ?").bind(passed.observedAt, failed.id).run();
    await assert.rejects(complete(job, passed), { code: "REPAIR_INSPECTION_INVALID" });
    const secondPass = await inspect(job);
    await recordInspection(db, { actor, equipmentId: 1, result: "failed", condition: "Standalone later failure" });
    await assert.rejects(complete(job, secondPass), { code: "REPAIR_INSPECTION_INVALID" });
    const latest = await inspect(job);
    assert.equal((await complete(job, latest)).stage, "completed");
    await assert.rejects(inspect(job), { code: "REPAIR_COMPLETED" });
  });

  it("rechecks inspections inside the completion transaction", async () => {
    const job = await open();
    const passed = await inspect(job);
    const racingDb = beforeBatch(() => inspect(job, { result: "failed", condition: "Fault discovered during completion" }));
    await assert.rejects(complete(job, passed, racingDb), { status: 409 });
    assert.equal((await jobRow(job)).stage, "reported");
    assert.equal((await equipment()).status, "attention");
    assert.equal((await db.prepare("SELECT count(*) AS n FROM repair_updates WHERE stage = 'completed'").first()).n, 0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM audit_events WHERE action = 'completed'").first()).n, 0);
  });

  it("prevents a stale stage write from regressing a concurrently completed job", async () => {
    const job = await open();
    const passed = await inspect(job);
    const racingDb = beforeBatch(() => complete(job, passed));
    await assert.rejects(updateRepair(racingDb, { actor, repairId: job.id, stage: "assessing" }), { status: 409 });
    assert.equal((await jobRow(job)).stage, "completed");
    assert.deepEqual((await db.prepare("SELECT stage FROM repair_updates ORDER BY id").all()).results.map((row) => row.stage), ["reported", "completed"]);
  });

  it("detects concurrent same-stage edits using history as an optimistic version", async () => {
    const job = await open();
    const racingDb = beforeBatch(() => updateRepair(db, { actor, repairId: job.id, stage: "reported", expectedReturnAt: "2099-01-01T00:00:00Z", publicMessage: "Winning update" }));
    await assert.rejects(updateRepair(racingDb, { actor, repairId: job.id, stage: "reported", publicMessage: "Stale update" }), { status: 409 });
    assert.equal((await jobRow(job)).expected_return_at, "2099-01-01T00:00:00.000Z");
    assert.equal((await listRepairs(db, 1))[0].latestPublicMessage, "Winning update");
  });

  it("uses actual location at commit for ready/away and retains the inspection's observed timestamp", async () => {
    const job = await open();
    const passed = await inspect(job);
    const observedAt = new Date(Date.now() - 60_000).toISOString();
    await db.prepare("UPDATE repair_jobs SET opened_at = ? WHERE id = ?").bind(new Date(Date.now() - 120_000).toISOString(), job.id).run();
    await db.prepare("UPDATE equipment_inspections SET observed_at = ? WHERE id = ?").bind(observedAt, passed.id).run();
    await complete(job, passed, beforeBatch(() => db.prepare("UPDATE equipment SET current_location_id = 2 WHERE id = 1").run()));
    assert.equal((await equipment()).status, "away");
    assert.equal((await equipment()).current_location_id, 2);
    assert.equal((await equipment()).last_inspected_at, observedAt);
    const secondJob = await open({ equipmentId: 2 });
    await complete(secondJob, await inspect(secondJob));
    assert.equal((await equipment(2)).status, "ready");
    const standalone = await recordInspection(db, { actor, equipmentId: 1, result: "passed", condition: "Still functional while away" });
    assert.equal((await equipment()).status, "away");
    assert.equal((await equipment()).last_inspected_at, standalone.observedAt);
  });

  it("atomically resolves a linked unresolved report once, retaining public history and completion audit", async () => {
    await report();
    const job = await open({ sourceReportId: 1 });
    const passed = await inspect(job);
    const results = await Promise.allSettled([complete(job, passed), complete(job, passed)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const resolved = await db.prepare("SELECT * FROM reports WHERE id = 1").first();
    assert.equal(resolved.status, "resolved");
    assert.ok(resolved.resolved_at);
    assert.equal(resolved.updated_at, resolved.resolved_at);
    const history = (await db.prepare("SELECT * FROM report_updates").all()).results;
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "resolved");
    assert.equal(history[0].author_id, actor.userId);
    assert.match(history[0].message, /Inspected and repaired/);
    assert.equal(history[0].message.includes("Internal supplier details"), false);
    const audit = (await db.prepare("SELECT * FROM audit_events WHERE entity_type = 'repair' AND action = 'completed'").all()).results;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].entity_id, String(job.id));
    assert.equal(JSON.parse(audit[0].details).inspectionId, passed.id);
  });

  it("rolls back completion, equipment, linked report and histories on audit or report-history failure", async () => {
    await report();
    const job = await open({ sourceReportId: 1 });
    const passed = await inspect(job);
    const baselineAudit = await count("audit_events");
    for (const [trigger, sql] of [
      ["reject_repair_audit", "BEFORE INSERT ON audit_events WHEN NEW.action = 'completed'"],
      ["reject_report_history", "BEFORE INSERT ON report_updates"],
    ]) {
      await db.prepare(`CREATE TRIGGER ${trigger} ${sql} BEGIN SELECT RAISE(ABORT, 'completion write unavailable'); END`).run();
      await assert.rejects(complete(job, passed), /completion write unavailable/);
      assert.equal((await jobRow(job)).stage, "reported");
      assert.equal((await jobRow(job)).completed_at, null);
      assert.equal((await equipment()).status, "service");
      assert.equal((await db.prepare("SELECT status FROM reports WHERE id = 1").first()).status, "in_progress");
      assert.equal(await count("repair_updates"), 1);
      assert.equal(await count("report_updates"), 0);
      assert.equal(await count("audit_events"), baselineAudit);
      await db.prepare(`DROP TRIGGER ${trigger}`).run();
    }
  });

  it("does not rewrite resolved/closed linked reports or add misleading resolution history", async () => {
    for (const [equipmentId, status] of [[1, "resolved"], [2, "closed"]]) {
      await report(equipmentId, equipmentId, status);
      const job = await open({ equipmentId, sourceReportId: equipmentId });
      await complete(job, await inspect(job));
      const row = await db.prepare("SELECT * FROM reports WHERE id = ?").bind(equipmentId).first();
      assert.equal(row.status, status);
      assert.equal(row.resolved_at, "2000-01-01T00:00:00.000Z");
      assert.equal(row.updated_at, "2000-01-01T00:00:00.000Z");
    }
    assert.equal(await count("report_updates"), 0);
  });
});
