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
 * The practice-room schedule runs on the institution's wall clock.
 * True School of Music operates in India, which is a fixed UTC+05:30 offset
 * (no daylight saving), so a constant offset keeps "today" and "now"
 * consistent across edge runtimes regardless of the Worker host timezone.
 */
export const INSTITUTION_UTC_OFFSET_MINUTES = 330;

/**
 * Bookable hours per calendar date: 00:00 to 24:00 (midnight).
 * The institution's operational day runs 06:00-06:00, so the "late-night"
 * period (00:00-06:00) belongs to the previous operational day but lives on
 * the next calendar date. Because slot rows are keyed by calendar date, the
 * full day 00:00-24:00 must be bookable for after-midnight selections to work.
 */
export const BOOKING_WINDOW_START_MINUTES = 0;
export const BOOKING_WINDOW_END_MINUTES = 1440;

export interface InstitutionNow {
  date: string; // YYYY-MM-DD on the institution's wall clock
  minutes: number; // minutes elapsed since local midnight
}

/**
 * Returns the current date and time-of-day on the institution's wall clock.
 * Accepts an optional epoch (ms) for deterministic testing.
 */
export function getInstitutionNow(nowMs: number = Date.now()): InstitutionNow {
  const shifted = new Date(nowMs + INSTITUTION_UTC_OFFSET_MINUTES * 60_000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return { date, minutes };
}

export function isValidCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/**
 * Converts an end time into minutes, treating "00:00" as the end of the
 * operational day (1440) so that the final 23:30–00:00 slot is bookable.
 */
export function normalizeEndMinutes(endTime: string): number {
  return endTime === "00:00" ? 1440 : timeToMinutes(endTime);
}

/**
 * True when a booking start has already passed on the institution clock.
 * A start exactly on the current minute is still considered upcoming.
 */
export function isStartInPast(
  date: string,
  startTime: string,
  now: InstitutionNow = getInstitutionNow()
): boolean {
  if (date < now.date) return true;
  if (date > now.date) return false;
  return timeToMinutes(startTime) < now.minutes;
}

/**
 * True when a booking's entire window has elapsed on the institution clock.
 */
export function isBookingElapsed(
  date: string,
  endTime: string,
  now: InstitutionNow = getInstitutionNow()
): boolean {
  if (date < now.date) return true;
  if (date > now.date) return false;
  return normalizeEndMinutes(endTime) <= now.minutes;
}

export type BookingPhase =
  | "upcoming"
  | "in_progress"
  | "completed"
  | "cancelled";

/**
 * Derives the presentational phase of a booking from its stored status and the
 * institution clock. Stored terminal statuses win over the clock.
 */
export function deriveBookingPhase(
  date: string,
  startTime: string,
  endTime: string,
  status: "confirmed" | "cancelled" | "completed",
  now: InstitutionNow = getInstitutionNow(),
  sessionEndedAt?: string | null,
): BookingPhase {
  if (status === "cancelled") return "cancelled";
  if (status === "completed" || sessionEndedAt) return "completed";
  if (isBookingElapsed(date, endTime, now)) return "completed";
  if (isStartInPast(date, startTime, now)) return "in_progress";
  return "upcoming";
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
export function validateBookingRequest(
  params: {
    date: string;
    startTime: string;
    endTime: string;
  },
  now: InstitutionNow = getInstitutionNow()
): BookingValidationResult {
  const { date, startTime, endTime } = params;

  if (!isValidCalendarDate(date)) {
    return { valid: false, error: "Invalid date. Expected a real calendar date in YYYY-MM-DD format." };
  }

  // Validate time formats (HH:MM, 24h)
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)
  ) {
    return { valid: false, error: "Invalid time format. Expected HH:MM." };
  }

  const startMins = timeToMinutes(startTime);
  const endMins = normalizeEndMinutes(endTime);

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

  // Enforce the per-calendar-date bookable window (00:00-24:00)
  if (startMins < BOOKING_WINDOW_START_MINUTES || endMins > BOOKING_WINDOW_END_MINUTES) {
    return {
      valid: false,
      error: "Requested time is outside bookable hours (00:00-24:00).",
    };
  }

  // Reject bookings for dates that have already passed
  if (date < now.date) {
    return {
      valid: false,
      error: "Bookings cannot be made for past dates. Please choose today or a future date.",
    };
  }

  // Reject bookings whose start time has already passed today
  if (isStartInPast(date, startTime, now)) {
    return {
      valid: false,
      error: "This time slot has already started or passed. Please choose a later time.",
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
 * Generates all 48 standard 30-minute slots for a given room and date,
 * covering the full calendar day: 00:00-06:00 (the late-night tail of the
 * previous operational day) plus 06:00-24:00 (the day's main grid).
 */
export function generateDailyTimeSlots(
  roomId: number,
  date: string
): TimeSlotDef[] {
  const slots: TimeSlotDef[] = [];

  // 00:00 is 0 mins; 24:00 is 1440 mins
  for (let m = 0; m < 1440; m += 30) {
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
  const year = getInstitutionNow().date.slice(0, 4);
  const randomPart = 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
  return `PR-${year}-${randomPart}`;
}
