import { getDb } from "@/db";

export async function GET() {
  try {
    const contacts = await getDb().$client.prepare(`
      SELECT id, name, team, email, phone, hours
      FROM support_contacts WHERE is_active = 1 ORDER BY sort_order, id
    `).all();
    return Response.json({ contacts: contacts.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
