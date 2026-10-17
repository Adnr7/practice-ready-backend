import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { getInstitutionNow, minutesToTime } from "../lib/booking-engine.ts";
import { reserveSlots } from "../lib/booking-store.ts";
import {
  BookingLifecycleError,
  cancelBooking,
  endActiveSession,
  getBookingView,
  rescheduleBooking,
} from "../lib/booking-lifecycle.ts";
import {
  listSessionEquipmentUsage,
  recordSessionEquipmentUsage,
  SessionUsageError,
} from "../lib/session-equipment-usage.ts";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const migrations = [
  "0000_lush_misty_knight.sql",
  "0001_new_the_hood.sql",
  "0002_open_layla_miller.sql",
  "0003_amusing_nekra.sql",
  "0004_equipment_movements.sql",
  "0005_reservation_lifecycle.sql",
];

async function applyMigrations(db) {
  for (const file of migrations) {
    const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").filter((part) => part.trim())) {
      await db.prepare(statement).run();
    }
  }
}

const student = { userId: 1, role: "student" };
const otherStudent = { userId: 2, role: "student" };
const technician = { userId: 3, role: "technician" };

async function addSlots(db, roomId, date, starts) {
  await db.batch(starts.map((start) => db.prepare(
    "INSERT INTO time_slots (room_id, date, period, start_time, end_time, status) VALUES (?, ?, 'morning', ?, ?, 'available')",
  ).bind(roomId, date, start, minutesToTime(Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 30))));
}

describe("Persistent reservation lifecycle and session equipment usage", () => {
  let emulator;
  let db;

  before(async () => {
    emulator = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-05-15", d1Databases: ["DB"] });
    db = await emulator.getD1Database("DB");
    await applyMigrations(db);
    await db.batch([
      db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES (1, 'one@example.com', 'hash', 'salt', 'Student One', 'student')"),
      db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES (2, 'two@example.com', 'hash', 'salt', 'Student Two', 'student')"),
      db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES (3, 'tech@example.com', 'hash', 'salt', 'Tech', 'technician')"),
      db.prepare("INSERT INTO locations (id, code, name, type) VALUES (1, 'mpr-2', 'MPR 2', 'room')"),
      db.prepare("INSERT INTO locations (id, code, name, type) VALUES (2, 'mpr-3', 'MPR 3', 'room')"),
      db.prepare("INSERT INTO rooms (id, name, code, capacity, description) VALUES (1, 'MPR 2', 'mpr-2', 6, 'Room two')"),
      db.prepare("INSERT INTO rooms (id, name, code, capacity, description) VALUES (2, 'MPR 3', 'mpr-3', 6, 'Room three')"),
      db.prepare("INSERT INTO equipment (id, equipment_id, name, type, condition, status, default_location_id, current_location_id, default_room_id) VALUES (1, 'MIC-01', 'Microphone', 'mic', 'Fully functional', 'ready', 1, 1, 1)"),
    ]);
  });

  after(async () => emulator?.dispose());

  beforeEach(async () => {
    await db.batch([
      db.prepare("DELETE FROM session_equipment_usage"),
      db.prepare("DELETE FROM booking_history"),
      db.prepare("DELETE FROM booking_claims"),
      db.prepare("DELETE FROM booking_slots"),
      db.prepare("DELETE FROM bookings"),
      db.prepare("DELETE FROM time_slots"),
    ]);
    await addSlots(db, 1, "2099-01-01", ["09:00", "09:30", "10:00", "10:30"]);
    await addSlots(db, 2, "2099-01-01", ["09:00", "09:30"]);
  });

  it("reschedules atomically and preserves the original booking on conflict", async () => {
    const booking = await reserveSlots(db, {
      bookingRef: "PR-2099-1001", userId: 1, guestStudentName: null, guestStudentId: null,
      roomId: 1, date: "2099-01-01", startTime: "09:00", endTime: "10:00", durationMinutes: 60,
    }, ["09:00", "09:30"]);
    assert.ok(booking);
    const updated = await rescheduleBooking(db, { bookingId: booking.id, actor: student, roomId: 1, date: "2099-01-01", startTime: "10:00", endTime: "11:00", version: 1 });
    assert.equal(updated.id, booking.id);
    assert.equal(updated.startTime, "10:00");
    assert.equal(await db.prepare("SELECT count(*) FROM booking_claims WHERE booking_id = ? AND time_slot_id IN (SELECT id FROM time_slots WHERE start_time IN ('10:00', '10:30'))").bind(booking.id).first("count(*)"), 2);

    const conflict = await reserveSlots(db, {
      bookingRef: "PR-2099-1002", userId: 2, guestStudentName: null, guestStudentId: null,
      roomId: 2, date: "2099-01-01", startTime: "09:00", endTime: "10:00", durationMinutes: 60,
    }, ["09:00", "09:30"]);
    assert.ok(conflict);
    await assert.rejects(
      rescheduleBooking(db, { bookingId: booking.id, actor: student, roomId: 2, date: "2099-01-01", startTime: "09:00", endTime: "10:00", version: 2 }),
      (error) => error instanceof BookingLifecycleError && error.code === "BOOKING_CONFLICT",
    );
    const preserved = await getBookingView(db, booking.id);
    assert.equal(preserved.startTime, "10:00");
    assert.equal(preserved.roomId, 1);
    assert.equal(await db.prepare("SELECT count(*) FROM booking_claims WHERE booking_id = ?").bind(booking.id).first("count(*)"), 2);
  });

  it("cancels idempotently and releases only its active claims", async () => {
    const first = await reserveSlots(db, { bookingRef: "PR-2099-1003", userId: 1, guestStudentName: null, guestStudentId: null, roomId: 1, date: "2099-01-01", startTime: "09:00", endTime: "10:00", durationMinutes: 60 }, ["09:00", "09:30"]);
    assert.ok(first);
    const cancelled = await cancelBooking(db, { bookingId: first.id, actor: student, version: 1 });
    assert.equal(cancelled.booking.status, "cancelled");
    const repeated = await cancelBooking(db, { bookingId: first.id, actor: student });
    assert.equal(repeated.alreadyCancelled, true);
    const replacement = await reserveSlots(db, { bookingRef: "PR-2099-1004", userId: 2, guestStudentName: null, guestStudentId: null, roomId: 1, date: "2099-01-01", startTime: "09:00", endTime: "10:00", durationMinutes: 60 }, ["09:00", "09:30"]);
    assert.ok(replacement);
    assert.equal(await db.prepare("SELECT count(*) FROM booking_claims WHERE booking_id = ?").bind(replacement.id).first("count(*)"), 2);
  });

  it("records one immutable equipment-use receipt for an active owner", async () => {
    const now = getInstitutionNow();
    const startMinutes = Math.max(0, Math.floor(now.minutes / 30) * 30 - 30);
    const startTime = minutesToTime(startMinutes);
    const endTime = minutesToTime(startMinutes + 120);
    await addSlots(db, 1, now.date, [startTime, minutesToTime(startMinutes + 30), minutesToTime(startMinutes + 60), minutesToTime(startMinutes + 90)]);
    const booking = await reserveSlots(db, { bookingRef: "PR-2099-1005", userId: 1, guestStudentName: null, guestStudentId: null, roomId: 1, date: now.date, startTime, endTime, durationMinutes: 120 }, [startTime, minutesToTime(startMinutes + 30), minutesToTime(startMinutes + 60), minutesToTime(startMinutes + 90)]);
    assert.ok(booking);
    const first = await recordSessionEquipmentUsage(db, { bookingId: booking.id, actor: student, equipmentIds: [1, 1] });
    assert.equal(first.replayed, false);
    assert.equal(first.usage.length, 1);
    const replay = await recordSessionEquipmentUsage(db, { bookingId: booking.id, actor: student, equipmentIds: [1] });
    assert.equal(replay.replayed, true);
    await assert.rejects(recordSessionEquipmentUsage(db, { bookingId: booking.id, actor: otherStudent, equipmentIds: [1] }), (error) => error instanceof SessionUsageError && error.status === 403);
    assert.equal((await listSessionEquipmentUsage(db, booking.id, student)).length, 1);
  });

  it("ends an active session, releases its claims, and is idempotent", async () => {
    const now = getInstitutionNow();
    const startMinutes = Math.max(0, Math.floor(now.minutes / 30) * 30 - 30);
    const startTime = minutesToTime(startMinutes);
    const endTime = minutesToTime(startMinutes + 120);
    await addSlots(db, 1, now.date, [startTime, minutesToTime(startMinutes + 30), minutesToTime(startMinutes + 60), minutesToTime(startMinutes + 90)]);
    const booking = await reserveSlots(db, { bookingRef: "PR-2099-1006", userId: 1, guestStudentName: null, guestStudentId: null, roomId: 1, date: now.date, startTime, endTime, durationMinutes: 120 }, [startTime, minutesToTime(startMinutes + 30), minutesToTime(startMinutes + 60), minutesToTime(startMinutes + 90)]);
    assert.ok(booking);
    const ended = await endActiveSession(db, { bookingId: booking.id, actor: student, version: 1 });
    assert.equal(ended.booking.phase, "completed");
    assert.equal(await db.prepare("SELECT count(*) FROM booking_claims WHERE booking_id = ?").bind(booking.id).first("count(*)"), 0);
    assert.equal((await endActiveSession(db, { bookingId: booking.id, actor: student })).alreadyEnded, true);
  });
});
