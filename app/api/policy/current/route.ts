import { getDb } from "@/db";
import { hasAllColumns, hasTable, schemaMigrationResponse } from "@/lib/schema-capabilities";

export async function GET() {
  try {
    const db = getDb().$client;
    if (!(await hasTable(db, "booking_policies")) || !(await hasAllColumns(db, "booking_policies", [
      "version", "slot_minutes", "minimum_minutes", "maximum_minutes", "advance_days",
      "opening_time", "closing_time", "cancellation_cutoff_minutes", "equipment_handling",
      "movement_rules", "published_at", "is_current",
    ]))) {
      return schemaMigrationResponse("Booking policy migration is required before policy data can be read.", { migration: "0007_frontend_workflows.sql" });
    }
    const marker = await db.prepare("SELECT 1 AS present FROM pragma_table_info('booking_policies') WHERE name = 'student_window' LIMIT 1").first<{ present: number }>();
    const policy = await db.prepare(`
      SELECT id, version, slot_minutes AS slotMinutes, minimum_minutes AS minimumMinutes,
        maximum_minutes AS maximumMinutes, advance_days AS advanceDays,
        opening_time AS openingTime, closing_time AS closingTime,
         cancellation_cutoff_minutes AS cancellationCutoffMinutes,
         ${marker?.present ? "student_window AS studentWindow," : ""}
        equipment_handling AS equipmentHandling, movement_rules AS movementRules,
        published_at AS publishedAt
      FROM booking_policies WHERE is_current = 1 LIMIT 1
    `).first();
    return Response.json({ policy: policy ?? null });
  } catch (error) {
    if (error instanceof Error && /no such table|booking_policies/i.test(error.message)) {
      return Response.json({ policy: null });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
