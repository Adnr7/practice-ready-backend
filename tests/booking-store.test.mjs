import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { reserveSlots, isBookingReferenceConflict, cancelStoredBooking } from "../lib/booking-store.ts";

// Use the same D1 emulator bundled with this project's Wrangler version.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");

describe("D1 atomic booking storage", () => {
  let emulator;
  let db;
  const booking = (ref) => ({
    bookingRef: ref, userId: null, guestStudentName: "Test student",
    guestStudentId: null, roomId: 1, date: "2099-01-01",
    startTime: "09:00", endTime: "10:00", durationMinutes: 60,
  });

  before(async () => {
    emulator = new Miniflare({
      modules: true, script: "export default { fetch() { return new Response('ok'); } }",
      compatibilityDate: "2026-05-15", d1Databases: ["DB"],
    });
    db = await emulator.getD1Database("DB");
    for (const file of ["0000_lush_misty_knight.sql", "0001_new_the_hood.sql", "0002_open_layla_miller.sql", "0003_amusing_nekra.sql", "0004_equipment_movements.sql", "0005_reservation_lifecycle.sql", "0006_room_readiness.sql", "0007_frontend_workflows.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      for (const sql of migration.split("--> statement-breakpoint").filter((sql) => sql.trim())) {
        await db.prepare(sql).run();
      }
    }
    await db.prepare("INSERT INTO rooms (id, name, code, capacity, description) VALUES (1, 'MPR 2', 'mpr-2', 6, 'Test')").run();
  });
  after(async () => { await emulator?.dispose(); });
  beforeEach(async () => {
    await db.batch([
      db.prepare("DROP TRIGGER IF EXISTS fail_booking_link"),
      db.prepare("DELETE FROM booking_slots"),
      db.prepare("DELETE FROM bookings"),
      db.prepare("DELETE FROM time_slots"),
      db.prepare(`INSERT INTO time_slots (room_id, date, period, start_time, end_time) VALUES
        (1, '2099-01-01', 'morning', '09:00', '09:30'),
        (1, '2099-01-01', 'morning', '09:30', '10:00'),
        (1, '2099-01-01', 'morning', '10:00', '10:30')`),
    ]);
  });

  it("allows only one of two simultaneous overlapping bookings", async () => {
    const results = await Promise.all([
      reserveSlots(db, booking("PR-2099-1001"), ["09:00", "09:30"]),
      reserveSlots(db, booking("PR-2099-1002"), ["09:00", "09:30"]),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await db.prepare("SELECT count(*) FROM bookings").first("count(*)"), 1);
    assert.equal(await db.prepare("SELECT count(*) FROM booking_slots").first("count(*)"), 2);
    assert.equal(await db.prepare("SELECT status FROM time_slots WHERE start_time = '10:00'").first("status"), "available");
  });

  it("treats legacy duplicate rows for one start time as a single slot", async () => {
    await db.prepare("DROP INDEX IF EXISTS idx_time_slots_unique").run();
    await db.prepare(`INSERT INTO time_slots (room_id, date, period, start_time, end_time) VALUES
      (1, '2099-01-01', 'morning', '09:00', '09:30'),
      (1, '2099-01-01', 'morning', '09:30', '10:00')`).run();

    const first = await reserveSlots(db, booking("PR-2099-1001"), ["09:00", "09:30"]);
    assert.ok(first);
    assert.equal(await db.prepare("SELECT count(*) FROM booking_slots").first("count(*)"), 2);

    const second = await reserveSlots(db, booking("PR-2099-1002"), ["09:00", "09:30"]);
    assert.equal(second, null);
  });

  it("rolls back all writes when linking a booking fails", async () => {
    await db.prepare("CREATE TRIGGER fail_booking_link BEFORE INSERT ON booking_slots BEGIN SELECT RAISE(ABORT, 'test failure'); END").run();
    await assert.rejects(reserveSlots(db, booking("PR-2099-1001"), ["09:00", "09:30"]));
    assert.equal(await db.prepare("SELECT count(*) FROM bookings").first("count(*)"), 0);
    assert.equal(await db.prepare("SELECT count(*) FROM time_slots WHERE status = 'available'").first("count(*)"), 3);
  });

  it("does not attach extra slots to an existing reference when the insert is rejected", async () => {
    await reserveSlots(db, booking("PR-2099-1001"), ["09:00", "09:30"]);
    const result = await reserveSlots(db, booking("PR-2099-1001"), ["09:30", "10:00"]);
    assert.equal(result, null);
    assert.equal(await db.prepare("SELECT count(*) FROM booking_slots").first("count(*)"), 2);
    assert.equal(await db.prepare("SELECT status FROM time_slots WHERE start_time = '10:00'").first("status"), "available");
  });

  it("recognizes reference collisions and leaves adjacent slots available for retry", async () => {
    await reserveSlots(db, booking("PR-2099-1001"), ["09:00", "09:30"]);
    await assert.rejects(
      reserveSlots(db, { ...booking("PR-2099-1001"), startTime: "10:00", endTime: "10:30", durationMinutes: 30 }, ["10:00"]),
      isBookingReferenceConflict,
    );
    const next = await reserveSlots(db, { ...booking("PR-2099-1002"), startTime: "10:00", endTime: "10:30", durationMinutes: 30 }, ["10:00"]);
    assert.equal(next.bookingRef, "PR-2099-1002");
  });

  it("rejects missing or maintenance slots without creating a partial booking", async () => {
    assert.equal(await reserveSlots(db, booking("PR-2099-1001"), ["09:00", "11:00"]), null);
    await db.prepare("UPDATE time_slots SET status = 'maintenance' WHERE start_time = '09:30'").run();
    assert.equal(await reserveSlots(db, booking("PR-2099-1002"), ["09:00", "09:30"]), null);
    assert.equal(await db.prepare("SELECT count(*) FROM bookings").first("count(*)"), 0);
  });

  it("releases a cancelled booking but a delayed second cancellation cannot release its replacement", async () => {
    const first = await reserveSlots(db, booking("PR-2099-1001"), ["09:00", "09:30"]);
    await cancelStoredBooking(db, first.id);
    assert.equal(await db.prepare("SELECT count(*) FROM time_slots WHERE status = 'available'").first("count(*)"), 3);
    await reserveSlots(db, booking("PR-2099-1002"), ["09:00", "09:30"]);
    await cancelStoredBooking(db, first.id);
    assert.equal(await db.prepare("SELECT count(*) FROM time_slots WHERE status = 'booked'").first("count(*)"), 2);
  });
});
