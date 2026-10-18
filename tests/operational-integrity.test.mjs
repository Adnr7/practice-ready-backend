import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyMigrationBatch, loadMigrations, openMigrationDatabase } from "../scripts/migration-tools.mjs";
import { reserveSlots } from "../lib/booking-store.ts";
import { rescheduleBooking } from "../lib/booking-lifecycle.ts";
import { bookingInstant, createRoomClosure, roomIsClosedForWindow } from "../lib/room-readiness.ts";
import { operationalConflictResponse } from "../lib/operational-conflicts.ts";

describe("Transaction-enforced reservation and closure boundaries", () => {
  let connection;
  let db;
  const booking = (ref, overrides = {}) => ({ bookingRef: ref, userId: 1, guestStudentName: null,
    guestStudentId: null, roomId: 1, date: "2099-01-01", startTime: "09:00", endTime: "10:00",
    durationMinutes: 60, ...overrides });
  const closure = () => createRoomClosure(db, { roomId: 1, actor: { userId: 3, role: "technician" },
    startsAt: "2099-01-01T03:30:00.000Z", endsAt: "2099-01-01T04:30:00.000Z", reason: "Maintenance window" });
  before(async () => {
    connection = await openMigrationDatabase(); db = connection.db;
    for (const migration of await loadMigrations()) await applyMigrationBatch(db, migration);
    await db.batch([
      db.prepare("INSERT INTO users (id,email,password_hash,salt,full_name,role) VALUES (1,'one@example.invalid','test','test','One','student'),(2,'two@example.invalid','test','test','Two','student'),(3,'tech@example.invalid','test','test','Tech','technician')"),
      db.prepare("INSERT INTO locations (id,code,name,type) VALUES (1,'room-1','Room 1','room'),(2,'room-2','Room 2','room')"),
      db.prepare("INSERT INTO rooms (id,name,code,capacity,description,location_id,readiness_state) VALUES (1,'Room 1','room-1',6,'Test',1,'usable'),(2,'Room 2','room-2',6,'Test',2,'usable')"),
      db.prepare("UPDATE booking_policies SET advance_days=36500"),
    ]);
  });
  after(async () => connection?.dispose());
  beforeEach(async () => {
    await db.batch([
      ...["room_closures", "booking_history", "booking_claims", "booking_slots", "bookings", "time_slots"].map((table) => db.prepare(`DELETE FROM ${table}`)),
      db.prepare("UPDATE rooms SET is_active=1,readiness_state='usable'"),
    ]);
    for (const roomId of [1, 2]) for (const startTime of ["00:00", "00:30", "09:00", "09:30", "10:00", "10:30"]) {
      const minutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + 30;
      const endTime = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      await db.prepare("INSERT INTO time_slots(room_id,date,period,start_time,end_time) VALUES (?,'2099-01-01','morning',?,?)").bind(roomId, startTime, endTime).run();
    }
  });

  it("allows only one simultaneous reservation for one student across different rooms", async () => {
    const results = await Promise.allSettled([
      reserveSlots(db, booking("R-1"), ["09:00", "09:30"]),
      reserveSlots(db, booking("R-2", { roomId: 2 }), ["09:00", "09:30"]),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled" && result.value).length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(operationalConflictResponse(rejected.reason).status, 409);
    assert.equal(await db.prepare("SELECT count(*) AS count FROM bookings").first("count"), 1);
    assert.equal(await db.prepare("SELECT count(*) AS count FROM booking_claims").first("count"), 2);
  });

  it("serializes booking versus closure creation so both cannot commit", async () => {
    const results = await Promise.allSettled([reserveSlots(db, booking("R-1"), ["09:00", "09:30"]), closure()]);
    assert.equal(results.filter((result) => result.status === "fulfilled" && result.value).length, 1);
    const count = await db.prepare("SELECT (SELECT count(*) FROM bookings)+(SELECT count(*) FROM room_closures) AS count").first("count");
    assert.equal(count, 1);
  });

  it("rolls back an attempted reschedule into a closure without losing the original reservation", async () => {
    const original = await reserveSlots(db, booking("R-1", { startTime: "10:00", endTime: "11:00" }), ["10:00", "10:30"]);
    await closure();
    await assert.rejects(rescheduleBooking(db, { bookingId: original.id, actor: { userId: 1, role: "student" }, roomId: 1,
      date: "2099-01-01", startTime: "09:00", endTime: "10:00", version: 1 }), /BOOKING_ROOM_CLOSED/);
    assert.deepEqual(await db.prepare("SELECT start_time,version,mutation_token FROM bookings").first(), { start_time: "10:00", version: 1, mutation_token: null });
    assert.equal(await db.prepare("SELECT count(*) AS count FROM booking_claims WHERE booking_id=?").bind(original.id).first("count"), 2);
    assert.equal(await db.prepare("SELECT count(*) AS count FROM booking_history WHERE action='rescheduled'").first("count"), 0);
  });

  it("allows adjacent bookings and different students in different rooms", async () => {
    assert.ok(await reserveSlots(db, booking("R-1"), ["09:00", "09:30"]));
    assert.ok(await reserveSlots(db, booking("R-2", { roomId: 2, userId: 2 }), ["09:00", "09:30"]));
    assert.ok(await reserveSlots(db, booking("R-3", { startTime: "10:00", endTime: "11:00" }), ["10:00", "10:30"]));
  });

  it("distinguishes a midnight start from the following midnight end", async () => {
    assert.equal(bookingInstant("2099-01-01", "00:00"), Date.parse("2098-12-31T18:30:00Z"));
    assert.equal(bookingInstant("2099-01-01", "00:00", true), Date.parse("2099-01-01T18:30:00Z"));
    await createRoomClosure(db, { roomId: 1, actor: { userId: 3, role: "technician" },
      startsAt: "2098-12-31T18:30:00Z", endsAt: "2098-12-31T19:00:00Z", reason: "Midnight maintenance" });
    assert.equal(await roomIsClosedForWindow(db, 1, "2099-01-01", "00:00", "00:30"), true);
    assert.equal(await roomIsClosedForWindow(db, 1, "2099-01-01", "00:30", "01:00"), false);
    await assert.rejects(reserveSlots(db, booking("R-1", { startTime: "00:00", endTime: "00:30", durationMinutes: 30 }), ["00:00"]), /BOOKING_ROOM_CLOSED/);
  });
});
