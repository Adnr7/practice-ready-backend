import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { createReport, generateReportReference, listAllReports, listReports, type ReportDatabase } from "@/lib/report-store";
import { createReportSchema } from "@/lib/report-validation";

function authRequired() {
  return Response.json({ error: "Authentication required." }, { status: 401 });
}

function validationError(error: { flatten: () => unknown }) {
  return Response.json(
    { error: "Invalid report request.", details: error.flatten() },
    { status: 400 },
  );
}

async function readJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
}

interface ReportContext {
  equipmentId?: number;
  roomId?: number;
  locationId?: number;
  bookingId?: number;
}

interface ContextFailure {
  status: 403 | 404;
  error: string;
}

async function validateContext(
  db: D1Database,
  context: ReportContext,
  userId: number,
  role: "student" | "technician" | "admin",
): Promise<ContextFailure | null> {
  if (context.equipmentId !== undefined) {
    const equipment = await db
      .prepare("SELECT id FROM equipment WHERE id = ? LIMIT 1")
      .bind(context.equipmentId)
      .first<{ id: number }>();
    if (!equipment) return { status: 404, error: "Equipment item not found." };
  }

  if (context.roomId !== undefined) {
    const room = await db
      .prepare("SELECT id FROM rooms WHERE id = ? LIMIT 1")
      .bind(context.roomId)
      .first<{ id: number }>();
    if (!room) return { status: 404, error: "Room not found." };
  }

  if (context.locationId !== undefined) {
    const location = await db
      .prepare("SELECT id FROM locations WHERE id = ? LIMIT 1")
      .bind(context.locationId)
      .first<{ id: number }>();
    if (!location) return { status: 404, error: "Location not found." };
  }

  if (context.bookingId !== undefined) {
    const booking = await db
      .prepare("SELECT id, user_id AS userId FROM bookings WHERE id = ? LIMIT 1")
      .bind(context.bookingId)
      .first<{ id: number; userId: number | null }>();
    if (!booking) return { status: 404, error: "Booking not found." };
    const isStaff = role === "technician" || role === "admin";
    if (!isStaff && booking.userId !== userId) {
      return { status: 403, error: "You can only attach your own booking to a report." };
    }
  }

  return null;
}

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return authRequired();

    const db = getDb().$client;
    const all = new URL(request.url).searchParams.get("mine") === "false";
    if (all && session.role !== "technician" && session.role !== "admin") {
      return Response.json({ error: "Only FTS technicians and administrators can list the report queue." }, { status: 403 });
    }
    const reports = all ? await listAllReports(db) : await listReports(db, session.userId);
    return Response.json({ reports });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return authRequired();

    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = createReportSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const db = getDb().$client;
    const contextFailure = await validateContext(db, parsed.data, session.userId, session.role);
    if (contextFailure) {
      return Response.json({ error: contextFailure.error }, { status: contextFailure.status });
    }

    const report = await createReport(db as ReportDatabase, {
      ...parsed.data,
      reference: generateReportReference(),
      reporterId: session.userId,
    });

    return Response.json({ report }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
