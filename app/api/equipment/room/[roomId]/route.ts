import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db";
import { equipment, locations, rooms } from "@/db/schema";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId: roomIdParam } = await params;
    const roomId = parseInt(roomIdParam, 10);

    if (isNaN(roomId) || roomId <= 0) {
      return Response.json(
        { error: "roomId must be a positive integer." },
        { status: 400 }
      );
    }

    const db = getDb();
    const [room] = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .limit(1);

    if (!room) {
      return Response.json({ error: "Room not found." }, { status: 404 });
    }

    const currentLoc = alias(locations, "current_loc");
    const defaultLoc = alias(locations, "default_loc");

    const items = await db
      .select({
        id: equipment.id,
        equipmentId: equipment.equipmentId,
        name: equipment.name,
        type: equipment.type,
        modelName: equipment.modelName,
        condition: equipment.condition,
        status: equipment.status,
        defaultLocationId: equipment.defaultLocationId,
        defaultLocationName: defaultLoc.name,
        currentLocationId: equipment.currentLocationId,
        currentLocationName: currentLoc.name,
        defaultRoomId: equipment.defaultRoomId,
        lastInspectedAt: equipment.lastInspectedAt,
        notes: equipment.notes,
      })
      .from(equipment)
      .leftJoin(currentLoc, eq(equipment.currentLocationId, currentLoc.id))
      .leftJoin(defaultLoc, eq(equipment.defaultLocationId, defaultLoc.id))
      .where(eq(equipment.defaultRoomId, roomId))
      .orderBy(equipment.type, equipment.name);

    // Group by readiness category
    const readyItems: typeof items = [];
    const awayItems: typeof items = [];
    const attentionItems: typeof items = [];

    for (const item of items) {
      if (item.status === "attention" || item.status === "service" || item.status === "missing") {
        attentionItems.push(item);
      } else if (item.status === "away" || (item.currentLocationName && !item.currentLocationName.includes(room.name))) {
        awayItems.push(item);
      } else {
        readyItems.push(item);
      }
    }

    return Response.json({
      room,
      summary: {
        total: items.length,
        readyCount: readyItems.length,
        awayCount: awayItems.length,
        attentionCount: attentionItems.length,
      },
      groups: {
        ready: readyItems,
        away: awayItems,
        attention: attentionItems,
      },
      all: items,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
