import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { rooms } from "@/db/schema";

export async function GET() {
  try {
    const db = getDb();
    const allRooms = await db
      .select()
      .from(rooms)
      .where(eq(rooms.isActive, true))
      .orderBy(rooms.id);

    return Response.json({ rooms: allRooms });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
