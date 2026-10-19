import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { rooms } from "@/db/schema";
import { getRoomReadiness } from "@/lib/room-readiness";
import { BOOKABLE_ROOM_CODES } from "@/lib/seed-data";

export async function GET() {
  try {
    const db = getDb();
    const allRooms = await db
      .select({
        id: rooms.id,
        name: rooms.name,
        code: rooms.code,
        capacity: rooms.capacity,
        description: rooms.description,
        isActive: rooms.isActive,
      })
      .from(rooms)
      .where(eq(rooms.isActive, true))
      .orderBy(rooms.id);

    const bookableRooms = allRooms.filter((room) => BOOKABLE_ROOM_CODES.includes(room.code as typeof BOOKABLE_ROOM_CODES[number]));

    const readiness = await Promise.all(bookableRooms.map((room) => getRoomReadiness(db.$client, room.id)));
    return Response.json({
      rooms: bookableRooms.map((room, index) => ({
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
