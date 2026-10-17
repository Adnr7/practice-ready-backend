import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { reserveSlots } from "../lib/booking-store.ts";
import { createRoomClosure, getRoomReadiness, roomIsClosedForWindow, updateRoomReadiness } from "../lib/room-readiness.ts";
import { createRepair, listRepairs, recordInspection, updateRepair } from "../lib/repair-store.ts";
import { findSuitableRooms } from "../lib/suitability.ts";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const migrations = [
  "0000_lush_misty_knight.sql", "0001_new_the_hood.sql", "0002_open_layla_miller.sql",
  "0003_amusing_nekra.sql", "0004_equipment_movements.sql", "0005_reservation_lifecycle.sql", "0006_room_readiness.sql",
];

async function applyMigrations(db) {
  for (const file of migrations) {
    const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").filter((part) => part.trim())) await db.prepare(statement).run();
  }
}

const technician = { userId: 3, role: "technician" };

describe("Persistent room readiness, repairs, and suitability", () => {
  let emulator;
  let db;
  before(async () => {
    emulator = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-05-15", d1Databases: ["DB"] });
    db = await emulator.getD1Database("DB");
    await applyMigrations(db);
    await db.batch([
      db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES (1, 'student@example.com', 'hash', 'salt', 'Student', 'student')"),
      db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES (3, 'tech@example.com', 'hash', 'salt', 'Tech', 'technician')"),
      db.prepare("INSERT INTO locations (id, code, name, type) VALUES (1, 'mpr-2', 'MPR 2', 'room')"),
      db.prepare("INSERT INTO locations (id, code, name, type) VALUES (2, 'arts-block-a', 'Arts Block A', 'block')"),
      db.prepare("INSERT INTO rooms (id, name, code, capacity, description) VALUES (1, 'MPR 2', 'mpr-2', 6, 'Practice room')"),
      db.prepare("INSERT INTO equipment (id, equipment_id, name, type, condition, status, default_location_id, current_location_id, default_room_id, last_inspected_at) VALUES (1, 'MIX-01', 'Mixer', 'mixer', 'Fully functional', 'away', 1, 2, 1, '2099-01-01T00:00:00.000Z')"),
      db.prepare("INSERT INTO equipment (id, equipment_id, name, type, condition, status, default_location_id, current_location_id, default_room_id, last_inspected_at) VALUES (2, 'MIC-01', 'Microphone', 'mic', 'Fully functional', 'ready', 1, 1, 1, '2099-01-01T00:00:00.000Z')"),
      db.prepare("UPDATE rooms SET location_id = 1 WHERE id = 1"),
    ]);
  });
  after(async () => emulator?.dispose());
  beforeEach(async () => {
    await db.batch([
      db.prepare("DELETE FROM room_closures"),
      db.prepare("DELETE FROM room_restrictions"),
      db.prepare("DELETE FROM repair_updates"),
      db.prepare("DELETE FROM equipment_inspections"),
      db.prepare("DELETE FROM repair_jobs"),
      db.prepare("DELETE FROM booking_claims"),
      db.prepare("DELETE FROM booking_slots"),
      db.prepare("DELETE FROM bookings"),
      db.prepare("DELETE FROM time_slots"),
      db.prepare("UPDATE rooms SET readiness_state = 'unknown', readiness_notes = NULL"),
      db.prepare("UPDATE equipment SET status = CASE WHEN id = 1 THEN 'away' ELSE 'ready' END, current_location_id = CASE WHEN id = 1 THEN 2 ELSE 1 END, condition = 'Fully functional'"),
    ]);
  });

  it("persists room state, restrictions, and refuses a closure that would strand a booking", async () => {
    const room = await getRoomReadiness(db, 1);
    assert.equal(room.locationId, 1);
    const updated = await updateRoomReadiness(db, { roomId: 1, actor: technician, state: "restricted", notes: "No amplified practice after 9 PM.", restriction: { activityKey: "vocal-amplified", state: "restricted", explanation: "Keep volume below the published limit." } });
    assert.equal(updated.readinessState, "restricted");
    assert.equal(updated.restrictions[0].state, "restricted");

    await db.batch([
      db.prepare("INSERT INTO time_slots (room_id, date, period, start_time, end_time) VALUES (1, '2099-01-01', 'morning', '09:00', '09:30')"),
      db.prepare("INSERT INTO time_slots (room_id, date, period, start_time, end_time) VALUES (1, '2099-01-01', 'morning', '09:30', '10:00')"),
    ]);
    const booking = await reserveSlots(db, { bookingRef: "PR-2099-3001", userId: 1, guestStudentName: null, guestStudentId: null, roomId: 1, date: "2099-01-01", startTime: "09:00", endTime: "10:00", durationMinutes: 60 }, ["09:00", "09:30"]);
    await assert.rejects(createRoomClosure(db, { roomId: 1, actor: technician, startsAt: "2099-01-01T03:00:00.000Z", endsAt: "2099-01-01T05:00:00.000Z", reason: "Deep maintenance" }), (error) => error.code === "ROOM_CLOSURE_BOOKING_CONFLICT");
    await db.prepare("DELETE FROM booking_claims WHERE booking_id = ?").bind(booking.id).run();
    await db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").bind(booking.id).run();
    const closure = await createRoomClosure(db, { roomId: 1, actor: technician, startsAt: "2099-01-01T03:00:00.000Z", endsAt: "2099-01-01T05:00:00.000Z", reason: "Deep maintenance" });
    assert.ok(closure.id);
    assert.equal(await roomIsClosedForWindow(db, 1, "2099-01-01", "09:00", "10:00"), true);
  });

  it("keeps repair ETA nullable and gates completion on a passed inspection", async () => {
    const repair = await createRepair(db, { equipmentId: 1, actor: technician, expectedReturnAt: null, publicMessage: "FTS is assessing the mixer." });
    assert.equal(repair.expectedReturnAt, null);
    await assert.rejects(updateRepair(db, { repairId: repair.id, actor: technician, stage: "completed" }), (error) => error.code === "REPAIR_INSPECTION_REQUIRED");
    const inspection = await recordInspection(db, { equipmentId: 1, actor: technician, result: "passed", condition: "Fully functional", repairJobId: repair.id });
    const completed = await updateRepair(db, { repairId: repair.id, actor: technician, stage: "completed", inspectionId: inspection.id, publicMessage: "Inspected and returned to service." });
    assert.equal(completed.stage, "completed");
    assert.equal((await listRepairs(db, 1))[0].overdue, false);
    assert.equal((await db.prepare("SELECT status FROM equipment WHERE id = 1").first()).status, "ready");
  });

  it("explains a partial amplified-vocal match when the room mixer is away", async () => {
    await updateRoomReadiness(db, { roomId: 1, actor: technician, state: "usable" });
    const result = await findSuitableRooms(db, { profile: "vocal", amplified: true, date: "2099-01-01", startTime: "09:00", endTime: "10:00", partySize: 1 });
    const room = result.rooms.find((item) => item.room.id === 1);
    assert.equal(room.suitability, "partial");
    assert.ok(room.reasons.some((reason) => reason.code === "REQUIRED_ITEM_AWAY"));
  });
});
