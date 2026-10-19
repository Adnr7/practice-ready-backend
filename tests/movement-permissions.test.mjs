import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { correctMovement, createMovement, parseCreateMovementBody, returnMovement } from "../lib/equipment-movements.ts";
import { listMovementDestinations, listMovementPermissions, saveMovementPermission } from "../lib/movement-permissions.ts";
import { getInstitutionNow } from "../lib/booking-engine.ts";
import { createStoredSession } from "../lib/session-store.ts";
import { applyMigrationBatch, loadMigrations } from "../scripts/migration-tools.mjs";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const student = { userId: 1, role: "student" };
const otherStudent = { userId: 2, role: "student" };
const technician = { userId: 3, role: "technician" };
const admin = { userId: 4, role: "admin" };
const designation = { equipmentId: 1, toLocationId: 2, isActive: true, reason: "Approved portable keyboard destination" };

async function migrations() {
  const journal = JSON.parse(await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"));
  if (journal.entries.some((entry) => entry.tag === "0010_movement_permissions")) return loadMigrations();
  // The main integration owns the 0009/0010 ledger entries. Exercise this slice independently until wired.
  const names = ["0000_lush_misty_knight.sql", "0001_new_the_hood.sql", "0002_open_layla_miller.sql", "0003_amusing_nekra.sql", "0004_equipment_movements.sql", "0005_reservation_lifecycle.sql", "0006_room_readiness.sql", "0007_frontend_workflows.sql", "0008_sessions.sql", "0010_movement_permissions.sql"];
  return Promise.all(names.map(async (name) => ({ name, sql: await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8") })));
}

function activeWindow() {
  const now = getInstitutionNow();
  const startMinutes = Math.max(0, Math.floor(now.minutes / 30) * 30 - 30);
  const endMinutes = Math.min(1440, Math.floor(now.minutes / 30) * 30 + 60);
  const time = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const end = Date.parse(`${now.date}T00:00:00Z`) + endMinutes * 60_000 - 330 * 60_000;
  return { date: now.date, start: time(startMinutes), end: time(endMinutes), duration: endMinutes - startMinutes, expectedReturnAt: new Date(Math.min(Date.now() + 10 * 60_000, end - 1000)).toISOString() };
}

describe("Policy-designated student equipment movements", () => {
  let emulator;
  let db;
  let window;
  const move = (overrides = {}) => createMovement(db, { actor: student, equipmentId: 1, toLocationId: 2, bookingId: 1, expectedReturnAt: window.expectedReturnAt, ...overrides });
  const call = (path, method = "GET", body, token) => emulator.dispatchFetch(`https://example.com${path}`, {
    method, headers: { ...(token ? { cookie: `pr_session=${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  before(async () => {
    const worker = await build({
      stdin: { contents: `
        import * as permissions from './app/api/staff/movement-permissions/route.ts';
        import * as movements from './app/api/equipment/[id]/movements/route.ts';
        import * as returns from './app/api/movements/[id]/return/route.ts';
        export default { async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === '/api/staff/movement-permissions') return permissions[request.method](request);
          const equipment = /^\\/api\\/equipment\\/([^/]+)\\/movements$/.exec(path);
          if (equipment) return movements[request.method](request, { params: Promise.resolve({ id: equipment[1] }) });
          const movement = /^\\/api\\/movements\\/([^/]+)\\/return$/.exec(path);
          if (movement) return returns.POST(request, { params: Promise.resolve({ id: movement[1] }) });
          return new Response('Not found', { status: 404 });
        } };
      `, resolveDir: fileURLToPath(new URL("../", import.meta.url)), sourcefile: "movement-permissions-worker.ts", loader: "ts" },
      bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", external: ["cloudflare:workers"],
    });
    emulator = new Miniflare({ modules: true, script: worker.outputFiles[0].text, compatibilityDate: "2026-05-15", d1Databases: ["DB"] });
    db = await emulator.getD1Database("DB");
    for (const migration of await migrations()) await applyMigrationBatch(db, migration);
    await db.batch([
      db.prepare(`INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES
        (1, 'one@example.com', 'hash', 'salt', 'Student One', 'student'),
        (2, 'two@example.com', 'hash', 'salt', 'Student Two', 'student'),
        (3, 'tech@example.com', 'hash', 'salt', 'Technician', 'technician'),
        (4, 'admin@example.com', 'hash', 'salt', 'Administrator', 'admin')`),
      db.prepare("INSERT INTO locations (id, code, name, type) VALUES (1, 'mpr-1', 'MPR 1', 'room'), (2, 'mpr-2', 'MPR 2', 'room'), (3, 'store', 'Storage', 'storage')"),
      db.prepare("INSERT INTO rooms (id, name, code, capacity, description, location_id) VALUES (1, 'MPR 1', 'mpr-1', 6, 'Practice room', 1), (2, 'MPR 2', 'mpr-2', 6, 'Practice room', 2)"),
      db.prepare("INSERT INTO equipment (id, equipment_id, name, type, current_location_id, default_location_id, default_room_id) VALUES (1, 'KEY-01', 'Keyboard', 'keyboard', 1, 1, 1), (2, 'MIX-01', 'Mixer', 'mixer', 1, 1, 1)"),
    ]);
  });
  after(async () => emulator?.dispose());
  beforeEach(async () => {
    window = activeWindow();
    await db.batch([
      db.prepare("DROP TRIGGER IF EXISTS reject_permission_audit"),
      ...["movement_return_events", "equipment_movements", "movement_permissions", "audit_events", "sessions", "bookings"].map((table) => db.prepare(`DELETE FROM ${table}`)),
      db.prepare("UPDATE equipment SET archived = 0, current_location_id = 1, status = 'ready', default_room_id = 1"),
      db.prepare("UPDATE users SET is_active = 1"),
      db.prepare("UPDATE rooms SET is_active = 1"),
      db.prepare("INSERT INTO bookings (id, booking_ref, user_id, room_id, date, start_time, end_time, duration_minutes) VALUES (1, 'PR-ACTIVE', 1, 1, ?, ?, ?, ?)")
        .bind(window.date, window.start, window.end, window.duration),
    ]);
  });

  it("denies undesignated equipment and destinations by default; reads back an audited exact pair", async () => {
    await assert.rejects(move(), { code: "MOVEMENT_NOT_DESIGNATED", status: 403 });
    const saved = await saveMovementPermission(db, technician, designation);
    assert.equal(saved.isActive, true);
    assert.equal(saved.toLocationName, "MPR 2");
    assert.deepEqual(await listMovementPermissions(db, admin), [saved]);
    await assert.rejects(move({ equipmentId: 2 }), { code: "MOVEMENT_NOT_DESIGNATED" });
    await assert.rejects(move({ toLocationId: 3 }), { code: "MOVEMENT_NOT_DESIGNATED" });
    const audit = await db.prepare("SELECT * FROM audit_events").first();
    assert.equal(audit.actor_user_id, technician.userId);
    assert.equal(audit.entity_id, String(saved.id));
    assert.deepEqual(JSON.parse(audit.details), { equipmentId: 1, toLocationId: 2, isActive: true });
    const movement = await move();
    assert.equal(movement.reservationId, 1);
    assert.equal(movement.equipmentCurrentLocationId, 2);
  });

  it("requires a real destination, positive ids, and literal booleans", async () => {
    await assert.rejects(saveMovementPermission(db, technician, { ...designation, toLocationId: 999 }), { code: "MOVEMENT_DESTINATION_INVALID", status: 400 });
    await assert.rejects(move({ toLocationId: 999 }), { code: "LOCATION_NOT_FOUND" });
    for (const equipmentId of [0, -1, 1.5, "1", true, [1]]) await assert.rejects(saveMovementPermission(db, technician, { ...designation, equipmentId }), { status: 400 });
    for (const equipmentId of [0, -1, 1.5, "1", true, [1]]) await assert.rejects(move({ equipmentId }), { code: "INVALID_EQUIPMENT_ID", status: 400 });
    for (const toLocationId of [0, -1, 1.5, "2", true, [2]]) await assert.rejects(saveMovementPermission(db, technician, { ...designation, toLocationId }), { status: 400 });
    for (const isActive of ["false", "true", 1, 0, null, undefined]) await assert.rejects(saveMovementPermission(db, technician, { ...designation, isActive }), { status: 400 });
    for (const toLocationId of [true, [2], {}]) assert.throws(() => parseCreateMovementBody({ toLocationId }), { status: 400 });
    assert.equal((await db.prepare("SELECT count(*) AS n FROM movement_permissions").first()).n, 0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM audit_events").first()).n, 0);
  });

  it("requires the active booking owner and equipment actually present in that room", async () => {
    await saveMovementPermission(db, technician, designation);
    await assert.rejects(move({ actor: otherStudent }), { code: "MOVEMENT_SESSION_NOT_ELIGIBLE" });
    await assert.rejects(move({ bookingId: undefined }), { code: "MOVEMENT_BOOKING_REQUIRED" });
    for (const update of ["UPDATE bookings SET status = 'cancelled'", "UPDATE bookings SET session_ended_at = CURRENT_TIMESTAMP", "UPDATE bookings SET room_id = 2", "UPDATE bookings SET date = '2099-01-01'", "UPDATE rooms SET is_active = 0 WHERE id = 1"]) {
      await db.prepare(update).run();
      await assert.rejects(move(), { code: "MOVEMENT_SESSION_NOT_ELIGIBLE" });
      await db.batch([db.prepare("UPDATE rooms SET is_active = 1"), db.prepare("UPDATE bookings SET status = 'confirmed', session_ended_at = NULL, room_id = 1, date = ?").bind(window.date)]);
    }
    await db.prepare("UPDATE equipment SET current_location_id = 3 WHERE id = 1").run();
    await assert.rejects(move(), { code: "MOVEMENT_SESSION_NOT_ELIGIBLE" });
    assert.equal((await db.prepare("SELECT count(*) AS n FROM equipment_movements").first()).n, 0);
  });

  it("validates calendar/clock timestamps and a strictly future return within session and three hours", async () => {
    await saveMovementPermission(db, technician, designation);
    for (const expectedReturnAt of ["tomorrow", "2026-02-30T10:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T10:60:00Z", "2026-01-01T10:00:00+05:30"]) {
      await assert.rejects(move({ expectedReturnAt }), { status: 400 });
    }
    for (const expectedReturnAt of [null, new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 4 * 60 * 60_000).toISOString()]) {
      await assert.rejects(move({ expectedReturnAt }), { code: "MOVEMENT_RETURN_WINDOW_INVALID" });
    }
    for (const timestamp of ["2099-01-01T10:00Z", "2099-01-01T10:00:00Z", "2099-01-01T10:00:00.1Z", "2099-01-01T10:00:00.12Z", "2099-01-01T10:00:00.123Z"]) assert.equal(parseCreateMovementBody({ toLocationId: 2, expectedReturnAt: timestamp }).expectedReturnAt, timestamp);
    const endMs = Date.parse(`${window.date}T${window.end}:00+05:30`) + (window.end === "00:00" ? 86400_000 : 0);
    await assert.rejects(move({ expectedReturnAt: new Date(endMs + 1000).toISOString() }), { code: "MOVEMENT_RETURN_WINDOW_INVALID" });
  });

  it("validates roles against active users for management and creation", async () => {
    for (const actor of [student, { userId: 3, role: "owner" }, { userId: 1, role: "admin" }, { userId: 999, role: "admin" }]) {
      await assert.rejects(saveMovementPermission(db, actor, designation), { status: 403 });
      await assert.rejects(listMovementPermissions(db, actor), { status: 403 });
    }
    await db.prepare("UPDATE users SET is_active = 0 WHERE id IN (1, 3)").run();
    await assert.rejects(saveMovementPermission(db, technician, designation), { status: 403 });
    await assert.rejects(move(), { status: 403 });
    await assert.rejects(move({ actor: { userId: 1, role: "admin" } }), { status: 403 });
  });

  it("permits staff moves without designation or reservation; blocks archived creation for everyone", async () => {
    const movement = await move({ actor: technician, bookingId: undefined, expectedReturnAt: null });
    assert.equal(movement.movedByUserId, 3);
    await db.prepare("UPDATE equipment SET archived = 1").run();
    await returnMovement(db, { actor: technician, movementId: movement.id });
    for (const actor of [student, technician, admin]) await assert.rejects(move({ actor }), { code: "EQUIPMENT_ARCHIVED" });
    await assert.rejects(saveMovementPermission(db, technician, designation), { code: "EQUIPMENT_ARCHIVED" });
  });

  it("revokes future creation while preserving owner returns and staff correction on archived items", async () => {
    await saveMovementPermission(db, technician, designation);
    const movement = await move();
    await saveMovementPermission(db, admin, { ...designation, isActive: false, reason: "Destination no longer approved" });
    await db.prepare("UPDATE equipment SET archived = 1 WHERE id = 1").run();
    await assert.rejects(returnMovement(db, { actor: otherStudent, movementId: movement.id }), { status: 403 });
    const returned = await returnMovement(db, { actor: student, movementId: movement.id });
    assert.equal(returned.status, "returned");
    const corrected = await correctMovement(db, { actor: technician, movementId: movement.id, locationId: 3, reason: "Stored safely after archival" });
    assert.equal(corrected.status, "corrected");
    await db.prepare("UPDATE equipment SET archived = 0, current_location_id = 1 WHERE id = 1").run();
    await assert.rejects(move(), { code: "MOVEMENT_NOT_DESIGNATED" });
  });

  it("rechecks revocation, session, archival and account changes inside the creation batch", async () => {
    for (const update of ["UPDATE movement_permissions SET is_active = 0", "UPDATE bookings SET status = 'cancelled'", "UPDATE equipment SET archived = 1 WHERE id = 1", "UPDATE users SET is_active = 0 WHERE id = 1"]) {
      await saveMovementPermission(db, technician, designation);
      const racingDb = { prepare: db.prepare.bind(db), batch: async (statements) => { await db.prepare(update).run(); return db.batch(statements); } };
      await assert.rejects(createMovement(racingDb, { actor: student, equipmentId: 1, toLocationId: 2, bookingId: 1, expectedReturnAt: window.expectedReturnAt }), { code: "MOVEMENT_CONFLICT" });
      assert.equal((await db.prepare("SELECT current_location_id FROM equipment WHERE id = 1").first()).current_location_id, 1);
      assert.equal((await db.prepare("SELECT count(*) AS n FROM equipment_movements").first()).n, 0);
      await db.batch([db.prepare("UPDATE bookings SET status = 'confirmed'"), db.prepare("UPDATE equipment SET archived = 0"), db.prepare("UPDATE users SET is_active = 1")]);
    }
  });

  it("rolls back both new designations and revocations if their audit cannot be recorded", async () => {
    await db.prepare("CREATE TRIGGER reject_permission_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END").run();
    await assert.rejects(saveMovementPermission(db, technician, designation), /audit unavailable/);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM movement_permissions").first()).n, 0);
    await db.prepare("DROP TRIGGER reject_permission_audit").run();
    const saved = await saveMovementPermission(db, technician, designation);
    await db.prepare("CREATE TRIGGER reject_permission_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END").run();
    await assert.rejects(saveMovementPermission(db, technician, { ...designation, isActive: false, reason: "Revoking the designation" }), /audit unavailable/);
    assert.deepEqual(await listMovementPermissions(db, admin), [saved]);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM audit_events").first()).n, 1);
  });

  it("rechecks staff account activity before committing a designation or its audit", async () => {
    const racingDb = { prepare: db.prepare.bind(db), batch: async (statements) => {
      await db.prepare("UPDATE users SET is_active = 0 WHERE id = 3").run();
      return db.batch(statements);
    } };
    await assert.rejects(saveMovementPermission(racingDb, technician, designation), { code: "MOVEMENT_PERMISSION_CONFLICT", status: 409 });
    assert.equal((await db.prepare("SELECT count(*) AS n FROM movement_permissions").first()).n, 0);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM audit_events").first()).n, 0);
  });

  it("only offers designated destinations to the eligible owner and all destinations to staff", async () => {
    assert.deepEqual(await listMovementDestinations(db, student, 1, 1), []);
    await saveMovementPermission(db, technician, designation);
    assert.deepEqual((await listMovementDestinations(db, student, 1, 1)).map((item) => item.id), [2]);
    await assert.rejects(listMovementDestinations(db, otherStudent, 1, 1), { status: 403 });
    assert.deepEqual((await listMovementDestinations(db, technician, 1)).map((item) => item.id), [2, 3]);
    await saveMovementPermission(db, technician, { ...designation, isActive: false });
    assert.deepEqual(await listMovementDestinations(db, student, 1, 1), []);
  });

  it("serves authenticated staff GET/PUT and owner-scoped destinations, creation, revocation and return routes", async () => {
    const path = "/api/staff/movement-permissions";
    assert.equal((await call(path)).status, 401);
    const studentToken = await createStoredSession(db, 1);
    const otherToken = await createStoredSession(db, 2);
    for (const method of ["GET", "PUT"]) assert.equal((await call(path, method, method === "PUT" ? designation : undefined, studentToken)).status, 403);
    const token = await createStoredSession(db, 3);
    assert.equal((await call(path, "PUT", { ...designation, isActive: "false" }, token)).status, 400);
    const saved = await call(path, "PUT", designation, token);
    assert.equal(saved.status, 200);
    const listed = await call(path, "GET", undefined, token);
    assert.equal(listed.headers.get("cache-control"), "no-store");
    assert.equal((await listed.json()).permissions[0].isActive, true);
    const destinationsPath = "/api/equipment/1/movements?bookingId=1";
    const destinations = await call(destinationsPath, "GET", undefined, studentToken);
    assert.equal(destinations.status, 200);
    assert.deepEqual((await destinations.json()).destinations.map((row) => row.id), [2]);
    assert.equal((await call(destinationsPath, "GET", undefined, otherToken)).status, 403);
    assert.equal((await call("/api/equipment/1x/movements", "GET", undefined, token)).status, 400);
    const payload = { toLocationId: 2, bookingId: 1, expectedReturnAt: window.expectedReturnAt };
    assert.equal((await call("/api/equipment/1/movements", "POST", payload, otherToken)).status, 403);
    const created = await call("/api/equipment/1/movements", "POST", payload, studentToken);
    assert.equal(created.status, 201, await created.clone().text());
    const movement = (await created.json()).movement;
    assert.equal((await call(path, "PUT", { ...designation, isActive: false }, token)).status, 200);
    assert.equal((await call(`/api/movements/${movement.id}/return`, "POST", {}, studentToken)).status, 200);
    assert.equal((await call("/api/equipment/1/movements", "POST", payload, studentToken)).status, 403);
    await db.prepare("UPDATE users SET is_active = 0 WHERE id = 3").run();
    assert.equal((await call(path, "GET", undefined, token)).status, 401);
    assert.equal((await call(path, "PUT", designation, token)).status, 401);
  });
});
