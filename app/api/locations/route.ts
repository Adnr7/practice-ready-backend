import { getDb } from "@/db";

export async function GET() {
  try {
    const locations = await getDb().$client.prepare("SELECT id, code, name, type FROM locations ORDER BY type, name").all();
    return Response.json({ locations: locations.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
