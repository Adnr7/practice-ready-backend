import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { getReport, updateReport, type ReportDatabase } from "@/lib/report-store";
import { updateReportSchema } from "@/lib/report-validation";

function authRequired() {
  return Response.json({ error: "Authentication required." }, { status: 401 });
}

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validationError(error: { flatten: () => unknown }) {
  return Response.json(
    { error: "Invalid report update.", details: error.flatten() },
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return authRequired();

    const id = parseId((await params).id);
    if (id === null) {
      return Response.json({ error: "Report id must be a positive integer." }, { status: 400 });
    }

    const report = await getReport(getDb().$client, id);
    if (!report) return Response.json({ error: "Report not found." }, { status: 404 });

    const isStaff = session.role === "technician" || session.role === "admin";
    if (!isStaff && report.reporterId !== session.userId) {
      return Response.json({ error: "Forbidden: You do not have access to this report." }, { status: 403 });
    }

    return Response.json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return authRequired();

    const isStaff = session.role === "technician" || session.role === "admin";
    if (!isStaff) {
      return Response.json(
        { error: "Forbidden: Only FTS technicians and administrators can update reports." },
        { status: 403 },
      );
    }

    const id = parseId((await params).id);
    if (id === null) {
      return Response.json({ error: "Report id must be a positive integer." }, { status: 400 });
    }

    const db = getDb().$client;
    const existing = await getReport(db, id);
    if (!existing) return Response.json({ error: "Report not found." }, { status: 404 });

    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = updateReportSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const report = await updateReport(db as ReportDatabase, id, session.userId, parsed.data);
    if (!report) return Response.json({ error: "Report not found." }, { status: 404 });

    return Response.json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
