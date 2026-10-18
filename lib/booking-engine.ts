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
  requiredSlotRefs?: BookingSlotRef[];
  endDate?: string;
}

export interface BookingSlotRef {
  date: string;
  startTime: string;
}

export interface BookingPolicy {
  id?: number;
  version: string;
  slotMinutes: number;
  minimumMinutes: number;
  maximumMinutes: number;
  advanceDays: number;
  openingTime: string;
  closingTime: string;
  cancellationCutoffMinutes: number;
  /** Whether this policy uses the current Asmi student booking window. */
  studentWindow?: boolean;
}

export const DEFAULT_BOOKING_POLICY: BookingPolicy = {
  version: "legacy-default",
  slotMinutes: 30,
  minimumMinutes: 30,
  maximumMinutes: 180,
  advanceDays: 36500,
  openingTime: "00:00",
  closingTime: "00:00",
  cancellationCutoffMinutes: 0,
  studentWindow: true,
};

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
  now: InstitutionNow = getInstitutionNow(),
  endDate?: string,
): boolean {
  const effectiveEndDate = endDate ?? date;
  if (effectiveEndDate < now.date) return true;
  if (effectiveEndDate > now.date) return false;
  if (date < now.date) return true;
  const endMinutes = endDate && endDate !== date ? timeToMinutes(endTime) : normalizeEndMinutes(endTime);
  return endMinutes <= now.minutes;
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
  endDate?: string | null,
): BookingPhase {
  if (status === "cancelled") return "cancelled";
  if (status === "completed" || sessionEndedAt) return "completed";
  if (isBookingElapsed(date, endTime, now, endDate ?? undefined)) return "completed";
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

export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function calendarDayDifference(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface ResolvedBookingWindow {
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  endOffsetMinutes: number;
  durationMinutes: number;
  requiredSlotRefs: BookingSlotRef[];
}

/**
 * Resolves both the existing same-day request shape and an overnight request.
 * A `23:30` → `00:30` request without endDate is inferred to end tomorrow;
 * the legacy final `23:30` → `00:00` slot remains the end boundary of date.
 */
export function resolveBookingWindow(params: {
  date: string;
  startTime: string;
  endTime: string;
  endDate?: string;
}): { valid: true; window: ResolvedBookingWindow } | { valid: false; error: string } {
  const { date, startTime, endTime } = params;
  if (!isValidCalendarDate(date)) {
    return { valid: false, error: "Invalid date. Expected a real calendar date in YYYY-MM-DD format." };
  }
  if (params.endDate !== undefined && !isValidCalendarDate(params.endDate)) {
    return { valid: false, error: "Invalid endDate. Expected a real calendar date in YYYY-MM-DD format." };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
    return { valid: false, error: "Invalid time format. Expected HH:MM." };
  }

  const startMinutes = timeToMinutes(startTime);
  const rawEndMinutes = timeToMinutes(endTime);
  let endDate = params.endDate;
  if (!endDate) {
    const inferredOvernight = rawEndMinutes <= startMinutes && startMinutes >= 18 * 60 && rawEndMinutes < 6 * 60;
    endDate = endTime === "00:00" || inferredOvernight ? addCalendarDays(date, 1) : date;
  }
  if (endDate < date) return { valid: false, error: "endDate cannot be before date." };

  const dayDifference = calendarDayDifference(date, endDate);
  const endOffsetMinutes = dayDifference * 1440 + rawEndMinutes;
  const durationMinutes = endOffsetMinutes - startMinutes;
  if (durationMinutes <= 0) return { valid: false, error: "End time must be after start time." };
  if (dayDifference > 1 || durationMinutes > 24 * 60) {
    return { valid: false, error: "Bookings may span at most one overnight boundary." };
  }

  const requiredSlotRefs: BookingSlotRef[] = [];
  for (let offset = startMinutes; offset < endOffsetMinutes; offset += 30) {
    const dayOffset = Math.floor(offset / 1440);
    requiredSlotRefs.push({ date: addCalendarDays(date, dayOffset), startTime: minutesToTime(offset) });
  }
  return {
    valid: true,
    window: {
      date,
      endDate,
      startTime,
      endTime,
      startMinutes,
      endMinutes: rawEndMinutes,
      endOffsetMinutes,
      durationMinutes,
      requiredSlotRefs,
    },
  };
}

/** Current Asmi student booking window, evaluated on the IST wall clock. */
export function isWithinAsmiStudentWindow(window: ResolvedBookingWindow, now: InstitutionNow): boolean {
  const tomorrow = addCalendarDays(now.date, 1);
  if (now.minutes < 360) {
    return window.date === now.date && window.startMinutes >= now.minutes && window.endOffsetMinutes <= 360;
  }
  if (window.date === now.date) {
    return window.startMinutes >= now.minutes && window.endOffsetMinutes <= 1440 + 360;
  }
  return window.date === tomorrow && window.startMinutes < 360 && window.endOffsetMinutes <= 360;
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
    endDate?: string;
  },
  now: InstitutionNow = getInstitutionNow(),
  policy: BookingPolicy = DEFAULT_BOOKING_POLICY,
): BookingValidationResult {
  const { date, startTime } = params;

  if (!isValidCalendarDate(date)) {
    return { valid: false, error: "Invalid date. Expected a real calendar date in YYYY-MM-DD format." };
  }

  const resolved = resolveBookingWindow(params);
  if (!resolved.valid) return resolved;
  const { window } = resolved;
  const startMins = window.startMinutes;
  const endMins = window.endOffsetMinutes;

  const slotMinutes = Number.isSafeInteger(policy.slotMinutes) && policy.slotMinutes > 0 ? policy.slotMinutes : 30;
  const minimumMinutes = Number.isSafeInteger(policy.minimumMinutes) && policy.minimumMinutes > 0 ? policy.minimumMinutes : 30;
  const maximumMinutes = Number.isSafeInteger(policy.maximumMinutes) && policy.maximumMinutes >= minimumMinutes ? policy.maximumMinutes : 180;
  const openingMins = timeToMinutes(policy.openingTime) === 0 && policy.openingTime === "00:00" ? 0 : timeToMinutes(policy.openingTime);
  const closingMins = policy.closingTime === "00:00" ? 1440 : timeToMinutes(policy.closingTime);

  // The D1 schedule has 30-minute rows; a published policy can require a
  // coarser booking increment while still reserving every underlying row.
  if (startMins % slotMinutes !== 0 || endMins % slotMinutes !== 0) {
    return {
      valid: false,
      error: slotMinutes === 30 ? "Bookings must be aligned to 30-minute intervals." : `Bookings must be aligned to ${slotMinutes}-minute intervals.`,
    };
  }

  const duration = window.durationMinutes;

  if (duration > maximumMinutes) {
    return {
      valid: false,
      error: maximumMinutes === 180 ? "Booking exceeds maximum allowed duration of 3 hours (180 minutes)." : `Booking exceeds the maximum allowed duration of ${maximumMinutes} minutes.`,
    };
  }

  if (duration < minimumMinutes) {
    return {
      valid: false,
      error: minimumMinutes === 30 ? "Booking duration must be at least 30 minutes." : `Booking duration must be at least ${minimumMinutes} minutes.`,
    };
  }

  if (startMins < openingMins || endMins > (window.date === window.endDate ? closingMins : 1440 + closingMins)) {
    return {
      valid: false,
      error: `Requested time is outside bookable hours (${policy.openingTime}-${policy.closingTime}).`,
    };
  }

  if (policy.studentWindow !== false && !isWithinAsmiStudentWindow(window, now)) {
    if (date < now.date) {
      return { valid: false, error: "Bookings cannot be made for past dates. Please choose today or tomorrow's 00:00-06:00 window." };
    }
    return { valid: false, error: "Asmi student bookings are limited to the remaining time today and tomorrow 00:00-06:00." };
  }

  if (policy.studentWindow === false) {
    if (date < now.date) {
      return {
        valid: false,
        error: "Bookings cannot be made for past dates. Please choose today or a future date.",
      };
    }
    const requestedDay = Date.parse(`${date}T00:00:00Z`);
    const currentDay = Date.parse(`${now.date}T00:00:00Z`);
    const advanceDays = Number.isSafeInteger(policy.advanceDays) && policy.advanceDays >= 0 ? policy.advanceDays : DEFAULT_BOOKING_POLICY.advanceDays;
    if (requestedDay > currentDay + advanceDays * 86_400_000) {
      return { valid: false, error: `Bookings can be made at most ${advanceDays} days in advance.` };
    }
    if (isStartInPast(date, startTime, now)) {
      return {
        valid: false,
        error: "This time slot has already started or passed. Please choose a later time.",
      };
    }
  } else if (date < now.date || (date === now.date && startMins < now.minutes)) {
    return {
      valid: false,
      error: "This time slot has already started or passed. Please choose a later time.",
    };
  }

  // Compute all continuous 30-minute slot start times
  const requiredSlots: string[] = [];
  for (const slot of window.requiredSlotRefs) requiredSlots.push(slot.startTime);

  return {
    valid: true,
    durationMinutes: duration,
    requiredSlots,
    requiredSlotRefs: window.requiredSlotRefs,
    endDate: window.endDate,
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
