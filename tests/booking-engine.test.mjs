import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateBookingRequest,
  generateDailyTimeSlots,
  getTimePeriod,
  generateBookingReference,
  timeToMinutes,
  minutesToTime,
} from "../lib/booking-engine.ts";

describe("Booking Engine & Conflict Prevention", () => {
  it("should validate valid consecutive 30-minute bookings", () => {
    const res = validateBookingRequest({
      date: "2026-10-01",
      startTime: "09:00",
      endTime: "11:00",
    });

    assert.equal(res.valid, true);
    assert.equal(res.durationMinutes, 120);
    assert.deepEqual(res.requiredSlots, ["09:00", "09:30", "10:00", "10:30"]);
  });

  it("should enforce maximum 3-hour duration policy", () => {
    // 3.5 hours
    const res = validateBookingRequest({
      date: "2026-10-01",
      startTime: "09:00",
      endTime: "12:30",
    });

    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("maximum allowed duration of 3 hours"));
  });

  it("should reject bookings not aligned to 30-minute steps", () => {
    const res = validateBookingRequest({
      date: "2026-10-01",
      startTime: "09:15",
      endTime: "10:15",
    });

    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("30-minute intervals"));
  });

  it("should reject invalid time sequences where endTime <= startTime", () => {
    const res = validateBookingRequest({
      date: "2026-10-01",
      startTime: "11:00",
      endTime: "10:00",
    });

    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("after start time"));
  });

  it("should map times to correct True School of Music periods", () => {
    assert.equal(getTimePeriod("06:30"), "early-morning");
    assert.equal(getTimePeriod("09:00"), "morning");
    assert.equal(getTimePeriod("12:00"), "afternoon");
    assert.equal(getTimePeriod("15:30"), "evening");
    assert.equal(getTimePeriod("18:30"), "night");
    assert.equal(getTimePeriod("21:30"), "late-night");
  });

  it("should generate all 36 daily time slots for an MPR", () => {
    const slots = generateDailyTimeSlots(3, "2026-10-01");
    assert.equal(slots.length, 36);
    assert.equal(slots[0].startTime, "06:00");
    assert.equal(slots[0].endTime, "06:30");
    assert.equal(slots[slots.length - 1].startTime, "23:30");
    assert.equal(slots[slots.length - 1].endTime, "00:00");

    // Check period distribution: 6 slots each for 6 periods
    const periods = slots.map((s) => s.period);
    assert.equal(periods.filter((p) => p === "early-morning").length, 6);
    assert.equal(periods.filter((p) => p === "morning").length, 6);
    assert.equal(periods.filter((p) => p === "afternoon").length, 6);
    assert.equal(periods.filter((p) => p === "evening").length, 6);
    assert.equal(periods.filter((p) => p === "night").length, 6);
    assert.equal(periods.filter((p) => p === "late-night").length, 6);
  });

  it("should generate unique institutional booking reference codes", () => {
    const ref1 = generateBookingReference();
    const ref2 = generateBookingReference();
    assert.ok(ref1.startsWith("PR-"));
    assert.ok(ref2.startsWith("PR-"));
    assert.notEqual(ref1, ref2);
  });
});
