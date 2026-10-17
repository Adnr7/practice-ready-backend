import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { rooms } from "@/db/schema";
import { getRoomReadiness } from "@/lib/room-readiness";

export async function GET() {
  try {
    const db = getDb();
    const allRooms = await db
      .select()
      .from(rooms)
      .where(eq(rooms.isActive, true))
      .orderBy(rooms.id);

    const readiness = await Promise.all(allRooms.map((room) => getRoomReadiness(db.$client, room.id)));
    return Response.json({
      rooms: allRooms.map((room, index) => ({
        ...room,
        readinessState: readiness[index]?.readinessState ?? "unknown",
        readinessNotes: readiness[index]?.readinessNotes ?? null,
        locationId: readiness[index]?.locationId ?? null,
        activeClosures: readiness[index]?.activeClosures ?? [],
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
