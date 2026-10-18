import { and, eq, like, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db";
import { equipment, locations } from "@/db/schema";
import { env } from "cloudflare:workers";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { readStaffJson, requireStaffActor, saveEquipmentCatalog, staffOperationErrorResponse } from "@/lib/staff-operations";

const EQUIPMENT_STATUSES = ["ready", "away", "attention", "service", "missing"] as const;
type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query")?.trim();
    const type = searchParams.get("type")?.trim();
    const locationIdParam = searchParams.get("locationId");
    const status = searchParams.get("status")?.trim();
    const includeArchived = searchParams.get("includeArchived") === "true";

    if (includeArchived) {
      configureAuthSecret(env.AUTH_SECRET);
      const session = await getSessionFromRequest(request);
      if (!session) return Response.json({ error: "Authentication required to include archived equipment." }, { status: 401 });
      requireStaffActor({ userId: session.userId, role: session.role });
    }

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
      if (!EQUIPMENT_STATUSES.includes(status as EquipmentStatus)) {
        return Response.json({ error: "Invalid equipment status." }, { status: 400 });
      }
      conditions.push(eq(equipment.status, status as EquipmentStatus));
    }

    if (!includeArchived) conditions.push(eq(equipment.archived, false));
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
        archived: equipment.archived,
        photoAttachmentId: equipment.photoAttachmentId,
      })
      .from(equipment)
      .leftJoin(currentLoc, eq(equipment.currentLocationId, currentLoc.id))
      .leftJoin(defaultLoc, eq(equipment.defaultLocationId, defaultLoc.id))
      .where(whereClause)
      .orderBy(equipment.type, equipment.name);

    return Response.json({ equipment: items });
  } catch (error) {
    return staffOperationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const db = getDb().$client;
    const session = await getSessionFromRequest(request, db);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireStaffActor({ userId: session.userId, role: session.role });
    const inserted = await saveEquipmentCatalog(db, session, await readStaffJson(request));
    return Response.json({ equipment: inserted }, { status: 201 });
  } catch (error) {
    return staffOperationErrorResponse(error);
  }
}
