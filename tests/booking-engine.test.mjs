import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateBookingRequest,
  generateDailyTimeSlots,
  getTimePeriod,
  generateBookingReference,
  getInstitutionNow,
  isStartInPast,
  isBookingElapsed,
  deriveBookingPhase,
  isValidCalendarDate,
} from "../lib/booking-engine.ts";

// Fixed reference point: 2026-10-01 at 00:00 institution time.
const NOW = { date: "2026-10-01", minutes: 0 };

describe("Booking Engine & Conflict Prevention", () => {
  it("should reject impossible calendar dates", () => {
    assert.equal(isValidCalendarDate("2026-02-29"), false);
    assert.equal(isValidCalendarDate("2026-04-31"), false);
    assert.equal(isValidCalendarDate("2026-02-28"), true);
  });

  it("should validate valid consecutive 30-minute bookings", () => {
    const res = validateBookingRequest(
      {
        date: "2026-10-01",
        startTime: "09:00",
        endTime: "11:00",
      },
      NOW
    );

    assert.equal(res.valid, true);
    assert.equal(res.durationMinutes, 120);
    assert.deepEqual(res.requiredSlots, ["09:00", "09:30", "10:00", "10:30"]);
  });

  it("should enforce maximum 3-hour duration policy", () => {
    // 3.5 hours
    const res = validateBookingRequest(
      {
        date: "2026-10-01",
        startTime: "09:00",
        endTime: "12:30",
      },
      NOW
    );

    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("maximum allowed duration of 3 hours"));
  });

  it("should reject bookings not aligned to 30-minute steps", () => {
    const res = validateBookingRequest(
      {
        date: "2026-10-01",
        startTime: "09:15",
        endTime: "10:15",
      },
      NOW
    );

    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("30-minute intervals"));
  });

  it("should reject invalid time sequences where endTime <= startTime", () => {
    const res = validateBookingRequest(
      {
        date: "2026-10-01",
        startTime: "11:00",
        endTime: "10:00",
      },
      NOW
    );

    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("after start time"));
  });

  it("should reject bookings for past dates", () => {
    const res = validateBookingRequest(
      {
        date: "2026-09-29",
        startTime: "07:30",
        endTime: "08:00",
      },
      NOW
    );

    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("past dates"));
  });

  it("should reject a today slot whose start time has already passed", () => {
    const evening = { date: "2026-10-01", minutes: 18 * 60 };
    const res = validateBookingRequest(
      {
        date: "2026-10-01",
        startTime: "07:30",
        endTime: "08:00",
      },
      evening
    );

    assert.equal(res.valid, false);
    assert.ok(res.error?.includes("already started or passed"));
  });

  it("should allow a later today slot when the start time is still ahead", () => {
    const now = { date: "2026-10-01", minutes: 18 * 60 };
    const res = validateBookingRequest(
      {
        date: "2026-10-01",
        startTime: "19:00",
        endTime: "19:30",
      },
      now
    );

    assert.equal(res.valid, true);
    assert.deepEqual(res.requiredSlots, ["19:00"]);
  });

  it("should accept the final slot ending at midnight (00:00)", () => {
    const res = validateBookingRequest(
      {
        date: "2026-10-01",
        startTime: "23:30",
        endTime: "00:00",
      },
      NOW
    );

    assert.equal(res.valid, true);
    assert.equal(res.durationMinutes, 30);
    assert.deepEqual(res.requiredSlots, ["23:30"]);
  });

  it("should accept late-night bookings in the early hours of the calendar date", () => {
    const res = validateBookingRequest(
      {
        date: "2026-10-01",
        startTime: "00:30",
        endTime: "02:00",
      },
      NOW
    );

    assert.equal(res.valid, true);
    assert.equal(res.durationMinutes, 90);
    assert.deepEqual(res.requiredSlots, ["00:30", "01:00", "01:30"]);
  });

  it("should accept a late-night booking ending at 06:00", () => {
    const res = validateBookingRequest(
      {
        date: "2026-10-01",
        startTime: "05:00",
        endTime: "06:00",
      },
      NOW
    );

    assert.equal(res.valid, true);
    assert.deepEqual(res.requiredSlots, ["05:00", "05:30"]);
  });

  it("should reject requests that wrap past midnight into the next day", () => {
    const res = validateBookingRequest(
      {
        date: "2026-10-01",
        startTime: "23:30",
        endTime: "00:30",
      },
      NOW
    );

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

  it("should generate all 48 daily time slots for an MPR", () => {
    const slots = generateDailyTimeSlots(3, "2026-10-01");
    assert.equal(slots.length, 48);
    assert.equal(slots[0].startTime, "00:00");
    assert.equal(slots[0].endTime, "00:30");
    assert.equal(slots[0].period, "late-night");
    assert.equal(slots[12].startTime, "06:00");
    assert.equal(slots[slots.length - 1].startTime, "23:30");
    assert.equal(slots[slots.length - 1].endTime, "00:00");

    // Check period distribution: overnight 00:00-06:00 and evening 21:00-24:00
    // both map to late-night; the other periods keep 6 slots each.
    const periods = slots.map((s) => s.period);
    assert.equal(periods.filter((p) => p === "early-morning").length, 6);
    assert.equal(periods.filter((p) => p === "morning").length, 6);
    assert.equal(periods.filter((p) => p === "afternoon").length, 6);
    assert.equal(periods.filter((p) => p === "evening").length, 6);
    assert.equal(periods.filter((p) => p === "night").length, 6);
    assert.equal(periods.filter((p) => p === "late-night").length, 18);
  });

  it("should generate unique institutional booking reference codes", () => {
    const ref1 = generateBookingReference();
    const ref2 = generateBookingReference();
    assert.ok(ref1.startsWith("PR-"));
    assert.ok(ref2.startsWith("PR-"));
    assert.notEqual(ref1, ref2);
  });
});

describe("Institution Time Helpers (IST / UTC+05:30)", () => {
  it("should convert an epoch to the institution wall clock", () => {
    // 2026-10-01T02:00:00Z is 2026-10-01 07:30 IST
    const now = getInstitutionNow(Date.UTC(2026, 9, 1, 2, 0, 0));
    assert.equal(now.date, "2026-10-01");
    assert.equal(now.minutes, 7 * 60 + 30);
  });

  it("should roll the institution date forward across the UTC midnight boundary", () => {
    // 2026-09-30T20:30:00Z is 2026-10-01 02:00 IST
    const now = getInstitutionNow(Date.UTC(2026, 8, 30, 20, 30, 0));
    assert.equal(now.date, "2026-10-01");
    assert.equal(now.minutes, 2 * 60);
  });

  it("should classify starts and elapsed windows against the institution clock", () => {
    const now = { date: "2026-10-01", minutes: 10 * 60 };

    assert.equal(isStartInPast("2026-09-30", "23:00", now), true);
    assert.equal(isStartInPast("2026-10-01", "09:30", now), true);
    assert.equal(isStartInPast("2026-10-01", "10:00", now), false);
    assert.equal(isStartInPast("2026-10-02", "06:00", now), false);

    assert.equal(isBookingElapsed("2026-10-01", "06:00", now), true);
    assert.equal(isBookingElapsed("2026-10-01", "11:00", now), false);
    assert.equal(isBookingElapsed("2026-10-01", "00:00", now), false);
  });
});

describe("Booking phase derivation", () => {
  const NOW = { date: "2026-10-01", minutes: 10 * 60 };

  it("classifies a future booking window as upcoming", () => {
    assert.equal(
      deriveBookingPhase("2026-10-01", "11:00", "11:30", "confirmed", NOW),
      "upcoming"
    );
    assert.equal(
      deriveBookingPhase("2026-10-02", "09:00", "09:30", "confirmed", NOW),
      "upcoming"
    );
  });

  it("classifies a window whose start has passed but end has not as in_progress", () => {
    assert.equal(
      deriveBookingPhase("2026-10-01", "09:30", "10:30", "confirmed", NOW),
      "in_progress"
    );
  });

  it("classifies a fully elapsed window as completed", () => {
    assert.equal(
      deriveBookingPhase("2026-10-01", "09:00", "09:30", "confirmed", NOW),
      "completed"
    );
    assert.equal(
      deriveBookingPhase("2026-09-30", "09:00", "09:30", "confirmed", NOW),
      "completed"
    );
  });

  it("passes through stored terminal statuses", () => {
    assert.equal(
      deriveBookingPhase("2026-10-01", "11:00", "11:30", "cancelled", NOW),
      "cancelled"
    );
    assert.equal(
      deriveBookingPhase("2026-10-01", "11:00", "11:30", "completed", NOW),
      "completed"
    );
  });
});
