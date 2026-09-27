import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { equipment, locations } from "@/db/schema";
import { getSessionFromRequest } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session || (session.role !== "technician" && session.role !== "admin")) {
      return Response.json(
        { error: "Forbidden: Only staff technicians and administrators can update equipment." },
        { status: 403 }
      );
    }

    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (isNaN(id) || id <= 0) {
      return Response.json(
        { error: "Equipment id must be a positive integer." },
        { status: 400 }
      );
    }

    const body = (await request.json()) as {
      condition?: string;
      status?: "ready" | "away" | "attention" | "service" | "missing";
      currentLocationId?: number;
      notes?: string;
    };

    const db = getDb();
    const [existing] = await db
      .select()
      .from(equipment)
      .where(eq(equipment.id, id))
      .limit(1);

    if (!existing) {
      return Response.json({ error: "Equipment item not found." }, { status: 404 });
    }

    if (body.currentLocationId) {
      const [loc] = await db
        .select()
        .from(locations)
        .where(eq(locations.id, body.currentLocationId))
        .limit(1);
      if (!loc) {
        return Response.json(
          { error: "Specified location does not exist." },
          { status: 400 }
        );
      }
    }

    const updates: Partial<typeof equipment.$inferInsert> = {
      lastInspectedAt: new Date().toISOString(),
    };

    if (body.condition !== undefined) updates.condition = body.condition;
    if (body.status !== undefined) updates.status = body.status;
    if (body.currentLocationId !== undefined) updates.currentLocationId = body.currentLocationId;
    if (body.notes !== undefined) updates.notes = body.notes;

    const [updated] = await db
      .update(equipment)
      .set(updates)
      .where(eq(equipment.id, id))
      .returning();

    return Response.json({ equipment: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
