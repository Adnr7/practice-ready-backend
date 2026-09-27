import { and, eq, ilike, like, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db";
import { equipment, locations, rooms } from "@/db/schema";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query")?.trim();
    const type = searchParams.get("type")?.trim();
    const locationIdParam = searchParams.get("locationId");
    const status = searchParams.get("status")?.trim();

    const db = getDb();
    const currentLoc = alias(locations, "current_loc");
    const defaultLoc = alias(locations, "default_loc");

    const conditions = [];

    if (query) {
      const pattern = `%${query}%`;
      conditions.push(
        or(
          like(equipment.name, pattern),
          like(equipment.equipmentId, pattern),
          like(equipment.modelName, pattern),
          like(equipment.type, pattern)
        )
      );
    }

    if (type) {
      conditions.push(eq(equipment.type, type));
    }

    if (locationIdParam) {
      const locId = parseInt(locationIdParam, 10);
      if (!isNaN(locId)) {
        conditions.push(eq(equipment.currentLocationId, locId));
      }
    }

    if (status) {
      conditions.push(eq(equipment.status, status as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
      .where(whereClause)
      .orderBy(equipment.type, equipment.name);

    return Response.json({ equipment: items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
