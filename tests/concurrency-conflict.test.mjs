import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateBookingRequest,
  generateDailyTimeSlots,
} from "../lib/booking-engine.ts";

describe("Booking Conflict & Concurrency Simulator", () => {
  it("should detect overlapping conflicts between requested and existing booked slots", () => {
    // Generate standard daily slots for room 3 on 2026-10-05
    const slots = generateDailyTimeSlots(3, "2026-10-05");

    // Student A books 10:00 to 11:30 (slots 10:00, 10:30, 11:00)
    const bookingA = validateBookingRequest({
      date: "2026-10-05",
      startTime: "10:00",
      endTime: "11:30",
    });
    assert.equal(bookingA.valid, true);

    // Apply Student A's booking to the slots
    for (const slot of slots) {
      if (bookingA.requiredSlots?.includes(slot.startTime)) {
        slot.status = "booked";
      }
    }

    // Student B attempts to book 10:30 to 12:00 (overlaps on 10:30 and 11:00)
    const bookingB = validateBookingRequest({
      date: "2026-10-05",
      startTime: "10:30",
      endTime: "12:00",
    });
    assert.equal(bookingB.valid, true);

    const conflictingSlots = slots
      .filter((s) => bookingB.requiredSlots?.includes(s.startTime) && s.status !== "available")
      .map((s) => s.startTime);

    assert.deepEqual(conflictingSlots, ["10:30", "11:00"]);
  });

  it("should permit non-overlapping adjacent bookings without conflict", () => {
    const slots = generateDailyTimeSlots(2, "2026-10-05");

    // Student A books 14:00 to 15:30
    const bookingA = validateBookingRequest({
      date: "2026-10-05",
      startTime: "14:00",
      endTime: "15:30",
    });

    for (const slot of slots) {
      if (bookingA.requiredSlots?.includes(slot.startTime)) {
        slot.status = "booked";
      }
    }

    // Student B books 15:30 to 17:00 (immediately adjacent, not overlapping)
    const bookingB = validateBookingRequest({
      date: "2026-10-05",
      startTime: "15:30",
      endTime: "17:00",
    });
    assert.equal(bookingB.valid, true);

    const conflicts = slots
      .filter((s) => bookingB.requiredSlots?.includes(s.startTime) && s.status !== "available")
      .map((s) => s.startTime);

    assert.equal(conflicts.length, 0);
  });
});
