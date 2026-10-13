import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  equipment,
  locations,
  rooms,
  timeSlots,
  users,
} from "@/db/schema";
import { configureAuthSecret, getSessionFromRequest, hashPassword } from "@/lib/auth";
import { generateDailyTimeSlots, getInstitutionNow } from "@/lib/booking-engine";
import {
  SEED_EQUIPMENT,
  SEED_LOCATIONS,
  SEED_ROOMS,
} from "@/lib/seed-data";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";

    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    const seedToken = env.SEED_TOKEN;
    if (session?.role !== "admin" &&
        !(seedToken && request.headers.get("authorization") === `Bearer ${seedToken}`)) {
      return Response.json({ error: "Administrator access or a valid seed token is required." }, { status: 403 });
    }

    const db = getDb();

    // Check if database already has rooms and slots
    const existingRooms = await db.select().from(rooms).limit(1);
    const existingSlots = await db.select().from(timeSlots).limit(1);

    if (existingRooms.length > 0 && existingSlots.length > 0 && !force) {
      return Response.json({
        message: "Database already seeded. Pass ?force=true to re-seed or update.",
      });
    }

    const [existingAdmin] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, "admin@tsm.edu.in")).limit(1);
    const adminPassword = env.ADMIN_PASSWORD;
    if (!existingAdmin && (!adminPassword || adminPassword.length < 12)) {
      return Response.json({ error: "Configure ADMIN_PASSWORD with at least 12 characters to bootstrap the administrator." }, { status: 503 });
    }

    // 1. Seed Locations
    const locationMap = new Map<string, number>();
    for (const loc of SEED_LOCATIONS) {
      const [existing] = await db
        .select()
        .from(locations)
        .where(eq(locations.code, loc.code))
        .limit(1);

      if (existing) {
        locationMap.set(loc.code, existing.id);
      } else {
        const [inserted] = await db
          .insert(locations)
          .values({
            code: loc.code,
            name: loc.name,
            type: loc.type,
          })
          .returning();
        locationMap.set(loc.code, inserted.id);
      }
    }

    // 2. Seed Rooms
    const roomMap = new Map<string, number>();
    for (const rm of SEED_ROOMS) {
      const [existing] = await db
        .select()
        .from(rooms)
        .where(eq(rooms.code, rm.code))
        .limit(1);

      if (existing) {
        roomMap.set(rm.code, existing.id);
      } else {
        const [inserted] = await db
          .insert(rooms)
          .values({
            name: rm.name,
            code: rm.code,
            capacity: rm.capacity,
            description: rm.description,
            isActive: true,
          })
          .returning();
        roomMap.set(rm.code, inserted.id);
      }
    }

    // 3. Seed Equipment
    let seededEquipmentCount = 0;
    for (const eqItem of SEED_EQUIPMENT) {
      const defLocId = locationMap.get(eqItem.defaultLocationCode) ?? null;
      const curLocId = locationMap.get(eqItem.currentLocationCode) ?? Array.from(locationMap.values())[0] ?? 1;
      const defRoomId = roomMap.get(eqItem.defaultRoomCode) ?? null;

      const [existing] = await db
        .select({ id: equipment.id })
        .from(equipment)
        .where(eq(equipment.equipmentId, eqItem.equipmentId))
        .limit(1);

      if (!existing) {
        await db.insert(equipment).values({
          equipmentId: eqItem.equipmentId,
          name: eqItem.name,
          type: eqItem.type,
          modelName: eqItem.modelName ?? null,
          condition: eqItem.condition,
          status: eqItem.status,
          defaultLocationId: defLocId,
          currentLocationId: curLocId,
          defaultRoomId: defRoomId,
          notes: eqItem.notes ?? null,
          lastInspectedAt: new Date().toISOString(),
        });
        seededEquipmentCount++;
      }
    }

    // 4. Seed Default Users
    if (!existingAdmin) {
      const adminPass = await hashPassword(adminPassword!);
      await db.insert(users).values({
        email: "admin@tsm.edu.in",
        passwordHash: adminPass.hash,
        salt: adminPass.salt,
        fullName: "TSM Facilities Administrator",
        role: "admin",
      });
    }

    const [existingStudent] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "student@tsm.edu.in"))
      .limit(1);

    if (!existingStudent && env.STUDENT_PASSWORD) {
      const studentPass = await hashPassword(env.STUDENT_PASSWORD);
      await db.insert(users).values({
        email: "student@tsm.edu.in",
        passwordHash: studentPass.hash,
        salt: studentPass.salt,
        fullName: "Elizabeth John",
        studentId: "TSM-2026-0042",
        role: "student",
      });
    }

    // 5. Pre-generate Time Slots for Next 14 Days
    const activeRooms = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.isActive, true));
    let seededSlotCount = 0;

    const startDate = new Date(`${getInstitutionNow().date}T00:00:00Z`);
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const d = new Date(startDate);
      d.setUTCDate(d.getUTCDate() + dayOffset);
      const dateStr = d.toISOString().split("T")[0];

      for (const r of activeRooms) {
        const [existing] = await db
          .select({ id: timeSlots.id })
          .from(timeSlots)
          .where(sql`${timeSlots.roomId} = ${r.id} AND ${timeSlots.date} = ${dateStr}`)
          .limit(1);

        if (!existing) {
          const slots = generateDailyTimeSlots(r.id, dateStr);
          // Insert in chunks of 10 (60 parameters) to stay well within D1's 100-parameter limit
          for (let i = 0; i < slots.length; i += 10) {
            await db.insert(timeSlots).values(slots.slice(i, i + 10)).onConflictDoNothing();
          }
          seededSlotCount += slots.length;
        }
      }
    }

    return Response.json({
      success: true,
      message: "Database seeded successfully with True School of Music data.",
      details: {
        rooms: roomMap.size,
        locations: locationMap.size,
        equipment: seededEquipmentCount,
        slotsGenerated: seededSlotCount,
        accounts: ["admin@tsm.edu.in"],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
