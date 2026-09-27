/**
 * Practice Ready Booking Validation & Slot Calculation Engine
 * Enforces university practice room policy constraints:
 * - 30-minute interval alignment
 * - Consecutive time slots only
 * - Maximum booking duration of 3 hours (6 consecutive 30-min slots)
 * - True School of Music 6-period daily schedule
 */

export type TimePeriod =
  | "early-morning"
  | "morning"
  | "afternoon"
  | "evening"
  | "night"
  | "late-night";

export interface TimeSlotDef {
  roomId: number;
  date: string;
  period: TimePeriod;
  startTime: string;
  endTime: string;
  status: "available" | "booked" | "maintenance";
}

export interface BookingValidationResult {
  valid: boolean;
  error?: string;
  durationMinutes?: number;
  requiredSlots?: string[]; // array of startTime strings
}

/**
 * Converts "HH:MM" to total minutes from midnight.
 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return NaN;
  return h * 60 + m;
}

/**
 * Converts total minutes from midnight to "HH:MM" 24h format.
 */
export function minutesToTime(minutes: number): string {
  const norm = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Determines which time period a given start time falls into.
 */
export function getTimePeriod(time: string): TimePeriod {
  const mins = timeToMinutes(time);
  if (mins >= 360 && mins < 540) return "early-morning"; // 06:00 - 08:59
  if (mins >= 540 && mins < 720) return "morning";       // 09:00 - 11:59
  if (mins >= 720 && mins < 900) return "afternoon";     // 12:00 - 14:59
  if (mins >= 900 && mins < 1080) return "evening";      // 15:00 - 17:59
  if (mins >= 1080 && mins < 1260) return "night";       // 18:00 - 20:59
  return "late-night";                                  // 21:00 - 05:59
}

/**
 * Validates a booking request according to university policy.
 */
export function validateBookingRequest(params: {
  date: string;
  startTime: string;
  endTime: string;
}): BookingValidationResult {
  const { date, startTime, endTime } = params;

  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { valid: false, error: "Invalid date format. Expected YYYY-MM-DD." };
  }

  // Validate time formats (HH:MM)
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return { valid: false, error: "Invalid time format. Expected HH:MM." };
  }

  const startMins = timeToMinutes(startTime);
  const endMins = timeToMinutes(endTime);

  // Must be in 30-minute intervals
  if (startMins % 30 !== 0 || endMins % 30 !== 0) {
    return {
      valid: false,
      error: "Bookings must be aligned to 30-minute intervals.",
    };
  }

  // End time must be strictly after start time
  if (endMins <= startMins) {
    return {
      valid: false,
      error: "End time must be after start time.",
    };
  }

  const duration = endMins - startMins;

  // Enforce maximum 3 hours (180 minutes) policy
  if (duration > 180) {
    return {
      valid: false,
      error: "Booking exceeds maximum allowed duration of 3 hours (180 minutes).",
    };
  }

  // Minimum duration: 30 minutes
  if (duration < 30) {
    return {
      valid: false,
      error: "Booking duration must be at least 30 minutes.",
    };
  }

  // Compute all continuous 30-minute slot start times
  const requiredSlots: string[] = [];
  for (let m = startMins; m < endMins; m += 30) {
    requiredSlots.push(minutesToTime(m));
  }

  return {
    valid: true,
    durationMinutes: duration,
    requiredSlots,
  };
}

/**
 * Generates all 36 standard 30-minute slots for a given room and date.
 * From 06:00 to 00:00 (midnight).
 */
export function generateDailyTimeSlots(
  roomId: number,
  date: string
): TimeSlotDef[] {
  const slots: TimeSlotDef[] = [];

  // 06:00 is 360 mins; 24:00 is 1440 mins
  for (let m = 360; m < 1440; m += 30) {
    const startTime = minutesToTime(m);
    const endTime = minutesToTime(m + 30);
    const period = getTimePeriod(startTime);

    slots.push({
      roomId,
      date,
      period,
      startTime,
      endTime,
      status: "available",
    });
  }

  return slots;
}

/**
 * Generates an institutional booking reference code (e.g. PR-2026-7842).
 */
export function generateBookingReference(): string {
  const year = new Date().getFullYear();
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `PR-${year}-${randomPart}`;
}
