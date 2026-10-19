import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { actOnReport, getStaffOperations, saveEquipmentCatalog, saveRoomCatalog } from "../lib/staff-operations.ts";
import { getSessionFromRequest } from "../lib/auth.ts";
import { createStoredSession } from "../lib/session-store.ts";

const require = createRequire(import.meta.url);
const { Miniflare } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const { build } = createRequire(require.resolve("wrangler/package.json"))("esbuild");
const technician = { userId: 3, role: "technician" };
const student = { userId: 1, role: "student" };
const snapshot = { expectedUpdatedAt: "2099-01-01T00:00:00.000Z", expectedStatus: "open", reason: "Investigating the reported fault" };
const repair = { ...snapshot, action: "repair", expectedReturnAt: null, privateNote: "Check the power supply" };
const closure = { ...snapshot, action: "closure", startsAt: "2099-01-01T03:30:00.000Z", endsAt: "2099-01-01T04:30:00.000Z" };
const roomInput = { name: "New room", code: "new-room", capacity: 6, description: "A practice space", locationId: 1, reason: "Adding new practice room" };
const equipmentInput = { equipmentId: "MIC-02", name: "Microphone", type: "mic", defaultLocationId: 1, reason: "New microphone delivered" };

describe("Atomic staff operations", () => {
  let emulator;
  let db;
  before(async () => {
    const worker = await build({
      stdin: { contents: `
        import * as operations from './app/api/staff/operations/route.ts';
        import * as action from './app/api/staff/reports/[id]/action/route.ts';
        import * as equipment from './app/api/equipment/route.ts';
        import * as equipmentItem from './app/api/equipment/[id]/route.ts';
        export default { async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === '/api/staff/operations') return operations[request.method](request);
          const report = /^\\/api\\/staff\\/reports\\/([^/]+)\\/action$/.exec(path);
          if (report) return action.POST(request, { params: Promise.resolve({ id: report[1] }) });
          if (path === '/api/equipment') return equipment[request.method](request);
          const item = /^\\/api\\/equipment\\/([^/]+)$/.exec(path);
          if (item) return equipmentItem.PATCH(request, { params: Promise.resolve({ id: item[1] }) });
          return new Response('Not found', { status: 404 });
        } };
      `, resolveDir: fileURLToPath(new URL("../", import.meta.url)), sourcefile: "staff-test-worker.ts", loader: "ts" },
      bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", external: ["cloudflare:workers"],
    });
    emulator = new Miniflare({ modules: true, script: worker.outputFiles[0].text, compatibilityDate: "2026-05-15", d1Databases: ["DB"] });
    db = await emulator.getD1Database("DB");
    for (const file of ["0000_lush_misty_knight.sql", "0001_new_the_hood.sql", "0002_open_layla_miller.sql", "0003_amusing_nekra.sql", "0004_equipment_movements.sql", "0005_reservation_lifecycle.sql", "0006_room_readiness.sql", "0007_frontend_workflows.sql", "0008_sessions.sql"]) {
      const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").filter((part) => part.trim())) await db.prepare(statement).run();
    }
    await db.batch([
      db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES (1, 'student@example.com', 'hash', 'salt', 'Student', 'student'), (3, 'tech@example.com', 'hash', 'salt', 'Technician', 'technician')"),
      db.prepare("INSERT INTO locations (id, code, name, type) VALUES (1, 'mpr-2', 'MPR 2', 'room'), (2, 'store', 'Storage', 'storage')"),
      db.prepare("INSERT INTO rooms (id, name, code, capacity, description, location_id) VALUES (1, 'MPR 2', 'mpr-2', 6, 'Practice room', 1)"),
      db.prepare("INSERT INTO equipment (id, equipment_id, name, type, current_location_id, default_location_id, default_room_id) VALUES (1, 'MIX-01', 'Mixer', 'mixer', 1, 1, 1)"),
    ]);
  });
  after(async () => emulator?.dispose());
  beforeEach(async () => {
    await db.batch([
      db.prepare("DROP TRIGGER IF EXISTS reject_staff_audit"),
      ...["audit_events", "report_updates", "repair_updates", "equipment_inspections", "repair_jobs", "room_closures", "reports", "bookings", "sessions"].map((table) => db.prepare(`DELETE FROM ${table}`)),
      db.prepare("DELETE FROM equipment WHERE id <> 1"),
      db.prepare("DELETE FROM rooms WHERE id <> 1"),
      db.prepare("UPDATE equipment SET status = 'ready', archived = 0, name = 'Mixer', last_inspected_at = NULL WHERE id = 1"),
      db.prepare("UPDATE users SET is_active = 1 WHERE id = 3"),
      db.prepare("UPDATE rooms SET is_active = 1 WHERE id = 1"),
      db.prepare("INSERT INTO reports (id, reference, reporter_id, category, equipment_id, room_id, description, updated_at) VALUES (1, 'RPT-1', 1, 'equipment', 1, 1, 'Mixer not powering on', '2099-01-01T00:00:00.000Z'), (2, 'RPT-2', 1, 'room', NULL, 1, 'Water leak', '2099-01-01T00:00:00.000Z')"),
    ]);
  });

  it("links a repair, equipment impact, public/private repair update, report history and audit together", async () => {
    const result = await actOnReport(db, technician, 1, repair);
    const job = await db.prepare("SELECT * FROM repair_jobs WHERE id = ?").bind(result.linkedId).first();
    assert.equal(job.source_report_id, 1);
    assert.equal(job.expected_return_at, null);
    assert.equal((await db.prepare("SELECT status FROM equipment WHERE id = 1").first()).status, "service");
    assert.equal((await db.prepare("SELECT status FROM reports WHERE id = 1").first()).status, "in_progress");
    const update = await db.prepare("SELECT * FROM repair_updates").first();
    assert.equal(update.private_note, repair.privateNote);
    const history = await db.prepare("SELECT * FROM report_updates").first();
    assert.match(history.message, new RegExp(`repair #${result.linkedId}`));
    assert.equal(history.message.includes(repair.privateNote), false);
    const audit = await db.prepare("SELECT * FROM audit_events").first();
    assert.equal(audit.action, "report_to_repair");
    assert.equal(JSON.parse(audit.details).linkedId, result.linkedId);
    const bootstrap = await getStaffOperations(db, technician);
    assert.equal(bootstrap.repairs[0].id, result.linkedId);
    assert.equal(bootstrap.repairs[0].privateNote, repair.privateNote);
    assert.deepEqual(bootstrap.reportLinks, [{ reportId: 1, linkedId: result.linkedId, action: "repair" }]);
  });

  it("allows only one concurrent action on a report and one open repair per equipment", async () => {
    const results = await Promise.allSettled([actOnReport(db, technician, 1, repair), actOnReport(db, technician, 1, repair)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.find((result) => result.status === "rejected").reason.code, "REPORT_ACTION_CONFLICT");
    await db.prepare("UPDATE reports SET category = 'equipment', equipment_id = 1 WHERE id = 2").run();
    await assert.rejects(actOnReport(db, technician, 2, repair), { code: "REPORT_ACTION_CONFLICT" });
    assert.equal((await db.prepare("SELECT count(*) AS n FROM repair_jobs").first()).n, 1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM report_updates").first()).n, 1);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM audit_events").first()).n, 1);
  });

  it("rejects stale or resolved report actions without side effects", async () => {
    await assert.rejects(actOnReport(db, technician, 1, { ...repair, expectedStatus: "acknowledged" }), { code: "REPORT_ACTION_CONFLICT" });
    await db.prepare("UPDATE reports SET status = 'resolved' WHERE id = 1").run();
    await assert.rejects(actOnReport(db, technician, 1, { ...repair, expectedStatus: "resolved" }), { code: "REPORT_ACTION_CONFLICT" });
    assert.equal((await db.prepare("SELECT count(*) AS n FROM repair_jobs").first()).n, 0);
  });

  it("rejects students and inactive accounts; authenticates only active DB-backed sessions", async () => {
    await assert.rejects(actOnReport(db, student, 1, repair), { status: 403 });
    await assert.rejects(saveRoomCatalog(db, student, roomInput), { status: 403 });
    await assert.rejects(saveEquipmentCatalog(db, student, equipmentInput), { status: 403 });
    await assert.rejects(getStaffOperations(db, student), { status: 403 });
    const token = await createStoredSession(db, 3);
    const request = new Request("https://example.com/api/staff/operations", { headers: { cookie: `pr_session=${token}` } });
    assert.equal((await getSessionFromRequest(request, db)).role, "technician");
    await db.prepare("UPDATE users SET is_active = 0 WHERE id = 3").run();
    assert.equal(await getSessionFromRequest(request, db), null);
    await assert.rejects(actOnReport(db, technician, 1, repair), { status: 403 });
    assert.equal((await db.prepare("SELECT count(*) AS n FROM audit_events").first()).n, 0);
  });

  it("rejects reservation and closure collisions using institution-local times, including midnight", async () => {
    await db.prepare("INSERT INTO bookings (booking_ref, user_id, room_id, date, start_time, end_time, duration_minutes) VALUES ('PR-1', 1, 1, '2099-01-01', '09:00', '10:00', 60)").run();
    await assert.rejects(actOnReport(db, technician, 2, closure), { code: "REPORT_ACTION_CONFLICT" });
    assert.equal((await db.prepare("SELECT status FROM reports WHERE id = 2").first()).status, "open");
    await db.prepare("UPDATE bookings SET start_time = '23:30', end_time = '00:00'").run();
    await assert.rejects(actOnReport(db, technician, 2, { ...closure, startsAt: "2099-01-01T18:00:00Z", endsAt: "2099-01-01T18:30:00Z" }), { code: "REPORT_ACTION_CONFLICT" });
    await db.prepare("DELETE FROM bookings").run();
    const linked = await actOnReport(db, technician, 2, closure);
    assert.ok(linked.linkedId);
    await assert.rejects(actOnReport(db, technician, 1, closure), { code: "REPORT_ACTION_CONFLICT" });
    const row = await db.prepare("SELECT * FROM room_closures").first();
    assert.equal(row.source_report_id, 2);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM audit_events").first()).n, 1);
    // Half-open adjacent windows are allowed.
    await actOnReport(db, technician, 1, { ...closure, startsAt: closure.endsAt, endsAt: "2099-01-01T05:00:00Z" });
  });

  it("rechecks a booking arriving after the pre-read and before the closure batch", async () => {
    const racingDb = {
      prepare: db.prepare.bind(db),
      batch: async (statements) => {
        await db.prepare("INSERT INTO bookings (booking_ref, user_id, room_id, date, start_time, end_time, duration_minutes) VALUES ('PR-RACE', 1, 1, '2099-01-01', '09:00', '10:00', 60)").run();
        return db.batch(statements);
      },
    };
    await assert.rejects(actOnReport(racingDb, technician, 2, closure), { code: "REPORT_ACTION_CONFLICT" });
    assert.equal((await db.prepare("SELECT count(*) AS n FROM room_closures").first()).n, 0);
  });

  it("rolls back report/repair/closure/history and catalog writes if the audit write fails", async () => {
    await db.prepare("CREATE TRIGGER reject_staff_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END").run();
    await assert.rejects(actOnReport(db, technician, 1, repair), /audit unavailable/);
    await assert.rejects(actOnReport(db, technician, 2, closure), /audit unavailable/);
    await assert.rejects(saveRoomCatalog(db, technician, roomInput), /audit unavailable/);
    await assert.rejects(saveRoomCatalog(db, technician, { name: "Changed room", reason: "Correcting the label" }, 1), /audit unavailable/);
    await assert.rejects(saveEquipmentCatalog(db, technician, equipmentInput), /audit unavailable/);
    await assert.rejects(saveEquipmentCatalog(db, technician, { name: "Changed mixer", reason: "Correcting the label" }, 1), /audit unavailable/);
    for (const table of ["repair_jobs", "repair_updates", "room_closures", "report_updates", "audit_events"]) assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n, 0);
    assert.equal((await db.prepare("SELECT status FROM reports WHERE id = 1").first()).status, "open");
    assert.equal((await db.prepare("SELECT status, name FROM equipment WHERE id = 1").first()).status, "ready");
    assert.equal((await db.prepare("SELECT name FROM equipment WHERE id = 1").first()).name, "Mixer");
    assert.equal((await db.prepare("SELECT count(*) AS n FROM rooms").first()).n, 1);
    assert.equal((await db.prepare("SELECT name FROM rooms WHERE id = 1").first()).name, "MPR 2");
    assert.equal((await db.prepare("SELECT count(*) AS n FROM equipment").first()).n, 1);
  });

  it("validates room/equipment catalog references, booleans, duplicate codes and archival booking conflicts", async () => {
    for (const changes of [{ capacity: 1.5 }, { locationId: 999 }, { code: "Bad Code" }, { isActive: "false" }]) await assert.rejects(saveRoomCatalog(db, technician, { ...roomInput, ...changes }), { status: 400 });
    const room = await saveRoomCatalog(db, technician, roomInput);
    assert.equal(room.name, roomInput.name);
    await assert.rejects(saveRoomCatalog(db, technician, roomInput), { code: "CATALOG_CODE_EXISTS" });
    const changed = await saveRoomCatalog(db, technician, { name: "Renamed room", reason: "Correcting room name" }, room.id);
    assert.equal(changed.name, "Renamed room");
    assert.equal((await saveRoomCatalog(db, technician, { isActive: false, reason: "Retiring the room" }, room.id)).isActive, 0);
    await db.prepare("INSERT INTO bookings (booking_ref, room_id, date, start_time, end_time, duration_minutes) VALUES ('PR-ARCHIVE', 1, '2099-01-01', '09:00', '10:00', 60)").run();
    await assert.rejects(saveRoomCatalog(db, technician, { isActive: false, reason: "Retiring booked room" }, 1), { code: "CATALOG_CONFLICT" });
    for (const changes of [{ currentLocationId: 999 }, { currentLocationId: null }, { condition: null }, { archived: "true" }, { name: 42 }, { photoAttachmentId: 9 }, { status: "invalid" }, { status: null }]) await assert.rejects(saveEquipmentCatalog(db, technician, { ...equipmentInput, ...changes }), { status: 400 });
    const item = await saveEquipmentCatalog(db, technician, equipmentInput);
    assert.equal(item.lastInspectedAt, null);
    assert.equal(item.status, "attention");
    await assert.rejects(saveEquipmentCatalog(db, technician, equipmentInput), { code: "CATALOG_CODE_EXISTS" });
    await assert.rejects(saveEquipmentCatalog(db, technician, { currentLocationId: 2, reason: "Untracked relocation" }, 1), { code: "CATALOG_CONFLICT" });
    await actOnReport(db, technician, 1, repair);
    await assert.rejects(saveEquipmentCatalog(db, technician, { status: "ready", reason: "Bypass inspection" }, 1), { code: "CATALOG_CONFLICT" });
    assert.equal((await getStaffOperations(db, technician)).equipment.find((row) => row.id === item.id).equipmentId, "MIC-02");
  });

  it("serves the real staff routes with DB sessions, role gates, input errors and atomic read-back", async () => {
    const call = async (path, method = "GET", body, token) => emulator.dispatchFetch(`https://example.com${path}`, {
      method, headers: { ...(token ? { cookie: `pr_session=${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal((await call("/api/staff/operations")).status, 401);
    const studentToken = await createStoredSession(db, 1);
    for (const [path, method, body] of [["/api/staff/operations", "GET"], ["/api/staff/operations", "POST", roomInput], ["/api/staff/reports/1/action", "POST", repair], ["/api/equipment", "POST", equipmentInput], ["/api/equipment/1", "PATCH", { name: "Forbidden", reason: "Unauthorized student" }], ["/api/equipment?includeArchived=true", "GET"]]) assert.equal((await call(path, method, body, studentToken)).status, 403);
    const token = await createStoredSession(db, 3);
    assert.equal((await call("/api/staff/reports/1x/action", "POST", repair, token)).status, 400);
    assert.equal((await call("/api/staff/operations", "POST", [], token)).status, 400);
    assert.equal((await call("/api/staff/operations", "PATCH", { id: [1], name: "Wrong", reason: "Invalid id shape" }, token)).status, 400);
    const created = await call("/api/staff/operations", "POST", roomInput, token);
    assert.equal(created.status, 201);
    const room = (await created.json()).room;
    assert.equal((await call("/api/staff/operations", "PATCH", { id: room.id, name: "Changed via API", reason: "Corrected room name" }, token)).status, 200);
    const catalog = await call("/api/equipment", "POST", equipmentInput, token);
    assert.equal(catalog.status, 201);
    const item = (await catalog.json()).equipment;
    assert.equal((await call(`/api/equipment/${item.id}`, "PATCH", { modelName: "SM58", reason: "Recorded exact model" }, token)).status, 200);
    const linked = await call("/api/staff/reports/1/action", "POST", repair, token);
    assert.equal(linked.status, 201);
    assert.equal((await call("/api/staff/reports/1/action", "POST", repair, token)).status, 409);
    const bootstrap = await call("/api/staff/operations", "GET", undefined, token);
    assert.equal(bootstrap.headers.get("cache-control"), "no-store");
    const data = await bootstrap.json();
    assert.equal(data.rooms.find((row) => row.id === room.id).name, "Changed via API");
    assert.equal(data.equipment.find((row) => row.id === item.id).modelName, "SM58");
    assert.equal(data.repairs[0].sourceReportId, 1);
    assert.equal((await call("/api/staff/operations", "DELETE", { id: room.id, reason: "Archive unused room" }, token)).status, 200);
    await db.prepare("UPDATE sessions SET revoked_at = unixepoch() WHERE user_id = 3").run();
    assert.equal((await call("/api/staff/operations", "GET", undefined, token)).status, 401);
  });
});
