import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyMigrationBatch, loadMigrations, openMigrationDatabase } from "../scripts/migration-tools.mjs";
import {
  DEFAULT_BOOKING_POLICY,
  validateBookingRequest,
} from "../lib/booking-engine.ts";
import { cancelStoredBooking, reserveSlots } from "../lib/booking-store.ts";
import { BOOKABLE_ROOM_CODES, NON_BOOKABLE_ROOM_CODES, SEED_ROOMS } from "../lib/seed-data.ts";

const ASMI_POLICY = { ...DEFAULT_BOOKING_POLICY, version: "asmi-test", advanceDays: 14, studentWindow: true };
const TODAY = "2026-10-18";

describe("Current Asmi backend contract", () => {
  it("declares exactly the seven current bookable rooms and keeps directory-only venues out", () => {
    assert.deepEqual(SEED_ROOMS.map((room) => room.name), ["MPR 2", "MPR 3", "MPR 4", "MPR 5", "Studio", "Live Room", "MP Lab 2"]);
    assert.deepEqual(SEED_ROOMS.map((room) => room.code), [...BOOKABLE_ROOM_CODES]);
    assert.ok(NON_BOOKABLE_ROOM_CODES.includes("perf-hall"));
    assert.ok(NON_BOOKABLE_ROOM_CODES.includes("mpr-1"));
    assert.equal(SEED_ROOMS.some((room) => ["Performance Hall", "MPR 1"].includes(room.name)), false);
  });

  it("enforces the IST 06:00 boundary for today, tomorrow tail, and farther dates", () => {
    const beforeSix = { date: TODAY, minutes: 5 * 60 };
    assert.equal(validateBookingRequest({ date: TODAY, startTime: "05:00", endTime: "05:30" }, beforeSix, ASMI_POLICY).valid, true);
    assert.equal(validateBookingRequest({ date: TODAY, startTime: "06:00", endTime: "06:30" }, beforeSix, ASMI_POLICY).valid, false);
    assert.equal(validateBookingRequest({ date: "2026-10-19", startTime: "00:00", endTime: "01:00" }, beforeSix, ASMI_POLICY).valid, false);

    const afterSix = { date: TODAY, minutes: 6 * 60 };
    assert.equal(validateBookingRequest({ date: TODAY, startTime: "06:00", endTime: "06:30" }, afterSix, ASMI_POLICY).valid, true);
    assert.equal(validateBookingRequest({ date: "2026-10-19", startTime: "00:00", endTime: "01:00" }, afterSix, ASMI_POLICY).valid, true);
    assert.equal(validateBookingRequest({ date: "2026-10-19", startTime: "06:00", endTime: "06:30" }, afterSix, ASMI_POLICY).valid, false);
    assert.equal(validateBookingRequest({ date: "2026-10-20", startTime: "00:00", endTime: "00:30" }, afterSix, ASMI_POLICY).valid, false);
    assert.equal(validateBookingRequest({ date: "2026-10-17", startTime: "09:00", endTime: "09:30" }, afterSix, ASMI_POLICY).valid, false);
  });

  it("resolves overnight selections to slot rows on both calendar dates", () => {
    const result = validateBookingRequest({ date: TODAY, startTime: "23:30", endTime: "00:30" }, { date: TODAY, minutes: 18 * 60 }, ASMI_POLICY);
    assert.equal(result.valid, true);
    assert.equal(result.endDate, "2026-10-19");
    assert.deepEqual(result.requiredSlotRefs, [
      { date: TODAY, startTime: "23:30" },
      { date: "2026-10-19", startTime: "00:00" },
    ]);
  });

  let connection;
  let db;
  before(async () => {
    connection = await openMigrationDatabase();
    db = connection.db;
    for (const migration of await loadMigrations()) await applyMigrationBatch(db, migration);
    await db.batch([
      db.prepare("INSERT INTO users (id,email,password_hash,salt,full_name,role) VALUES (1,'asmi@example.invalid','test','test','Asmi Student','student')"),
      db.prepare("INSERT INTO locations (id,code,name,type) VALUES (1,'mpr-2','MPR 2','room'),(2,'mpr-3','MPR 3','room')"),
      db.prepare("INSERT INTO rooms (id,name,code,capacity,description,location_id,readiness_state) VALUES (1,'MPR 2','mpr-2',6,'MPR 2',1,'usable'),(2,'MPR 3','mpr-3',8,'MPR 3',2,'usable')"),
      db.prepare("INSERT INTO time_slots(room_id,date,period,start_time,end_time) VALUES (1,'2099-01-01','late-night','23:30','00:00'),(1,'2099-01-02','late-night','00:00','00:30'),(2,'2099-01-01','late-night','23:30','00:00'),(2,'2099-01-02','late-night','00:00','00:30')"),
    ]);
  });
  after(async () => connection?.dispose());

  it("reads an overnight booking back and rejects overlap while preserving claims", async () => {
    const refs = [{ date: "2099-01-01", startTime: "23:30" }, { date: "2099-01-02", startTime: "00:00" }];
    const first = await reserveSlots(db, {
      bookingRef: "PR-2099-7001", userId: 1, guestStudentName: null, guestStudentId: null,
      roomId: 1, date: "2099-01-01", endDate: "2099-01-02", startTime: "23:30", endTime: "00:30", durationMinutes: 60,
    }, refs);
    assert.ok(first);
    const stored = await db.prepare("SELECT date,end_date,start_time,end_time FROM bookings WHERE id = ?").bind(first.id).first();
    assert.deepEqual(stored, { date: "2099-01-01", end_date: "2099-01-02", start_time: "23:30", end_time: "00:30" });
    assert.equal(await db.prepare("SELECT count(*) AS count FROM booking_claims WHERE booking_id = ?").bind(first.id).first("count"), 2);

    const overlap = await reserveSlots(db, {
      bookingRef: "PR-2099-7002", userId: 1, guestStudentName: null, guestStudentId: null,
      roomId: 1, date: "2099-01-01", endDate: "2099-01-02", startTime: "23:30", endTime: "00:30", durationMinutes: 60,
    }, refs);
    assert.equal(overlap, null);
    await cancelStoredBooking(db, first.id);
    assert.equal(await db.prepare("SELECT count(*) AS count FROM booking_claims WHERE booking_id = ?").bind(first.id).first("count"), 0);
    assert.equal(await db.prepare("SELECT count(*) AS count FROM time_slots WHERE status = 'available'").first("count"), 4);
  });

  it("does not allow a room closure to overlap the next-day portion of an overnight booking", async () => {
    const refs = [{ date: "2099-01-01", startTime: "23:30" }, { date: "2099-01-02", startTime: "00:00" }];
    const booking = await reserveSlots(db, {
      bookingRef: "PR-2099-7010", userId: 1, guestStudentName: null, guestStudentId: null,
      roomId: 2, date: "2099-01-01", endDate: "2099-01-02", startTime: "23:30", endTime: "00:30", durationMinutes: 60,
    }, refs);
    assert.ok(booking);
    await assert.rejects(
      db.prepare(`INSERT INTO room_closures (room_id, starts_at, ends_at, reason, created_by_user_id)
        VALUES (2, '2099-01-01T18:45:00.000Z', '2099-01-01T19:30:00.000Z', 'Overnight closure check', 1)`).run(),
      /ROOM_CLOSURE_BOOKING_CONFLICT/,
    );
  });
});
