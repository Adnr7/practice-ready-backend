import { getDb } from "@/db";

export async function GET() {
  try {
    const policy = await getDb().$client.prepare(`
      SELECT id, version, slot_minutes AS slotMinutes, minimum_minutes AS minimumMinutes,
        maximum_minutes AS maximumMinutes, advance_days AS advanceDays,
        opening_time AS openingTime, closing_time AS closingTime,
        cancellation_cutoff_minutes AS cancellationCutoffMinutes,
        equipment_handling AS equipmentHandling, movement_rules AS movementRules,
        published_at AS publishedAt
      FROM booking_policies WHERE is_current = 1 LIMIT 1
    `).first();
    return Response.json({ policy: policy ?? null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
