import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  correctMovement,
  createMovement,
  listMovements,
  MovementError,
  parseCreateMovementBody,
  returnMovement,
} from "../lib/equipment-movements.ts";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");

const student = { userId: 1, role: "student" };
const otherStudent = { userId: 2, role: "student" };
const technician = { userId: 3, role: "technician" };

async function applyMigrations(db) {
  for (const file of [
    "0000_lush_misty_knight.sql",
    "0001_new_the_hood.sql",
    "0002_rich_korath.sql",
  ]) {
    const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").filter((sql) => sql.trim())) {
      await db.prepare(statement).run();
    }
  }
}

describe("Persistent equipment movement workflow", () => {
  let emulator;
  let db;

  before(async () => {
    emulator = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } }",
      compatibilityDate: "2026-05-15",
      d1Databases: ["DB"],
    });
    db = await emulator.getD1Database("DB");
    await applyMigrations(db);
    await db.batch([
      db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES (1, 'one@example.com', 'hash', 'salt', 'Student One', 'student')"),
      db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES (2, 'two@example.com', 'hash', 'salt', 'Student Two', 'student')"),
      db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES (3, 'tech@example.com', 'hash', 'salt', 'Tech User', 'technician')"),
      db.prepare("INSERT INTO locations (id, code, name, type) VALUES (1, 'storage', 'Storage', 'storage')"),
      db.prepare("INSERT INTO locations (id, code, name, type) VALUES (2, 'mpr-2', 'MPR 2', 'room')"),
      db.prepare("INSERT INTO locations (id, code, name, type) VALUES (3, 'mpr-3', 'MPR 3', 'room')"),
      db.prepare("INSERT INTO equipment (id, equipment_id, name, type, current_location_id, status) VALUES (1, 'KEY-01', 'Keyboard', 'keyboard', 1, 'ready')"),
    ]);
  });

  after(async () => { await emulator?.dispose(); });

  beforeEach(async () => {
    await db.batch([
      db.prepare("DELETE FROM movement_return_events"),
      db.prepare("DELETE FROM equipment_movements"),
      db.prepare("UPDATE equipment SET current_location_id = 1, status = 'ready' WHERE id = 1"),
      db.prepare("DROP TRIGGER IF EXISTS fail_movement_insert"),
      db.prepare("DROP TRIGGER IF EXISTS fail_return_event"),
    ]);
  });

  it("creates a persistent movement and atomically updates the current location", async () => {
    const movement = await createMovement(db, {
      actor: student,
      equipmentId: 1,
      toLocationId: 2,
      expectedReturnAt: "2099-01-01T10:00:00Z",
      notes: "Practice session",
    });

    assert.equal(movement.status, "open");
    assert.equal(movement.fromLocationId, 1);
    assert.equal(movement.toLocationId, 2);
    assert.equal(movement.returnEvents.length, 0);
    assert.equal(await db.prepare("SELECT current_location_id FROM equipment WHERE id = 1").first("current_location_id"), 2);
    assert.equal(await db.prepare("SELECT count(*) FROM equipment_movements WHERE status = 'open'").first("count(*)"), 1);
  });

  it("enforces one open movement and prevents a stale/competing move", async () => {
    await createMovement(db, { actor: student, equipmentId: 1, toLocationId: 2 });

    await assert.rejects(
      createMovement(db, { actor: otherStudent, equipmentId: 1, toLocationId: 3 }),
      (error) => error instanceof MovementError && error.code === "OPEN_MOVEMENT_EXISTS" && error.status === 409,
    );
    assert.equal(await db.prepare("SELECT current_location_id FROM equipment WHERE id = 1").first("current_location_id"), 2);
    assert.equal(await db.prepare("SELECT count(*) FROM equipment_movements").first("count(*)"), 1);
  });

  it("allows only the owner or staff to return, and persists a return event", async () => {
    const movement = await createMovement(db, { actor: student, equipmentId: 1, toLocationId: 2 });

    await assert.rejects(
      returnMovement(db, { actor: otherStudent, movementId: movement.id }),
      (error) => error instanceof MovementError && error.status === 403,
    );
    assert.equal(await db.prepare("SELECT status FROM equipment_movements WHERE id = ?").bind(movement.id).first("status"), "open");

    const returned = await returnMovement(db, {
      actor: student,
      movementId: movement.id,
      notes: "Returned after rehearsal",
    });
    assert.equal(returned.status, "returned");
    assert.equal(returned.returnLocationId, 1);
    assert.equal(returned.returnEvents.length, 1);
    assert.equal(returned.returnEvents[0].eventType, "return");
    const equipment = await db.prepare("SELECT current_location_id, status FROM equipment WHERE id = 1").first();
    assert.equal(equipment.current_location_id, 1);
    assert.equal(equipment.status, "ready");

    await assert.rejects(
      returnMovement(db, { actor: student, movementId: movement.id }),
      (error) => error instanceof MovementError && error.code === "MOVEMENT_ALREADY_CLOSED",
    );
  });

  it("records staff correction, closes an open movement, and exposes history by owner", async () => {
    const movement = await createMovement(db, { actor: student, equipmentId: 1, toLocationId: 2 });
    const corrected = await correctMovement(db, {
      actor: technician,
      movementId: movement.id,
      locationId: 3,
      reason: "Technician found the keyboard in MPR 3",
    });

    assert.equal(corrected.status, "corrected");
    assert.equal(corrected.returnLocationId, 3);
    assert.equal(corrected.returnEvents.length, 1);
    assert.equal(corrected.returnEvents[0].eventType, "correction");
    assert.equal((await db.prepare("SELECT current_location_id FROM equipment WHERE id = 1").first()).current_location_id, 3);
    assert.equal(await db.prepare("SELECT count(*) FROM equipment_movements WHERE status = 'open'").first("count(*)"), 0);

    const mine = await listMovements(db, student, { mine: true, limit: 50, offset: 0 });
    assert.equal(mine.length, 1);
    assert.equal(mine[0].id, movement.id);
    const all = await listMovements(db, technician, { mine: false, limit: 50, offset: 0 });
    assert.equal(all.length, 1);
  });

  it("rolls back location and movement writes when return history insertion fails", async () => {
    const movement = await createMovement(db, { actor: student, equipmentId: 1, toLocationId: 2 });
    await db.prepare("CREATE TRIGGER fail_return_event BEFORE INSERT ON movement_return_events BEGIN SELECT RAISE(ABORT, 'test return failure'); END").run();

    await assert.rejects(returnMovement(db, { actor: student, movementId: movement.id }));
    assert.equal((await db.prepare("SELECT current_location_id FROM equipment WHERE id = 1").first()).current_location_id, 2);
    assert.equal((await db.prepare("SELECT status FROM equipment_movements WHERE id = ?").bind(movement.id).first()).status, "open");
    assert.equal(await db.prepare("SELECT count(*) FROM movement_return_events").first("count(*)"), 0);
  });

  it("rejects invalid movement input before touching the database", () => {
    assert.throws(
      () => parseCreateMovementBody({ toLocationId: 2, expectedReturnAt: "tomorrow" }),
      (error) => error instanceof MovementError && error.status === 400,
    );
    assert.throws(
      () => parseCreateMovementBody({ toLocationId: 0 }),
      (error) => error instanceof MovementError && error.status === 400,
    );
  });
});
