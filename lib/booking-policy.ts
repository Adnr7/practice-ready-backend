import { DEFAULT_BOOKING_POLICY, type BookingPolicy } from "./booking-engine.ts";

export async function getBookingPolicy(db: D1Database, version: string): Promise<BookingPolicy | null> {
  try {
    const marker = await db.prepare("SELECT 1 AS present FROM pragma_table_info('booking_policies') WHERE name = 'student_window' LIMIT 1").first<{ present: number }>();
    const policy = await db.prepare(`
      SELECT id, version, slot_minutes AS slotMinutes, minimum_minutes AS minimumMinutes,
        maximum_minutes AS maximumMinutes, advance_days AS advanceDays,
        opening_time AS openingTime, closing_time AS closingTime,
        cancellation_cutoff_minutes AS cancellationCutoffMinutes
        ${marker?.present ? ", student_window AS studentWindow" : ""}
      FROM booking_policies WHERE version = ? LIMIT 1
    `).bind(version).first<BookingPolicy>();
    // A database with the original policy table predates the current Asmi
    // contract. Keep it usable until the reviewed marker migration is applied.
    return policy ? { ...policy, studentWindow: marker?.present ? Boolean(policy.studentWindow) : false } : null;
  } catch (error) {
    if (error instanceof Error && /no such table|booking_policies/i.test(error.message)) return null;
    throw error;
  }
}

export async function getCurrentBookingPolicy(db: D1Database): Promise<BookingPolicy> {
  try {
    const row = await db.prepare("SELECT version FROM booking_policies WHERE is_current = 1 ORDER BY id DESC LIMIT 1").first<{ version: string }>();
    const policy = row ? await getBookingPolicy(db, row.version) : null;
    if (policy) return policy;
    return DEFAULT_BOOKING_POLICY;
  } catch (error) {
    if (error instanceof Error && /no such table|booking_policies/i.test(error.message)) return DEFAULT_BOOKING_POLICY;
    throw error;
  }
}
