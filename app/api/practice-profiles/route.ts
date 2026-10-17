import { getDb } from "@/db";

export async function GET() {
  try {
    const db = getDb().$client;
    const profiles = await db.prepare("SELECT id, code, name, category, description, version FROM practice_profiles WHERE is_active = 1 ORDER BY id").all();
    const requirements = await db.prepare("SELECT id, profile_id AS profileId, requirement_key AS requirementKey, label, equipment_type AS equipmentType, equipment_name_pattern AS equipmentNamePattern, quantity, is_hard AS isHard, student_supplied AS studentSupplied FROM practice_requirements ORDER BY id").all();
    return Response.json({ profiles: profiles.results, requirements: requirements.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
