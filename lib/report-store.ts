import type { ReportCategory, ReportStatus } from "./report-validation";
import { runIdempotentBatch, type IdempotencyRequest } from "./idempotency.ts";

export interface ReportDatabase {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface CreateReportInput {
  reference: string;
  reporterId: number;
  category: ReportCategory;
  equipmentId?: number;
  roomId?: number;
  locationId?: number;
  bookingId?: number;
  issueType?: string;
  description: string;
  attachmentIds?: number[];
}

export interface ReportUpdateRecord {
  id: number;
  reportId: number;
  authorId: number;
  authorName: string | null;
  status: ReportStatus | null;
  message: string | null;
  createdAt: string;
}

export interface ReportRecord {
  id: number;
  reference: string;
  reporterId: number;
  category: ReportCategory;
  equipmentId: number | null;
  equipmentName: string | null;
  roomId: number | null;
  roomName: string | null;
  locationId: number | null;
  locationName: string | null;
  bookingId: number | null;
  issueType: string | null;
  description: string;
  attachmentIds: number[];
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  updates: ReportUpdateRecord[];
}

type ReportRow = Omit<ReportRecord, "updates" | "attachmentIds"> & {
  attachmentIds: string | number[] | null;
};

export function generateReportReference(now = new Date()): string {
  const year = now.getUTCFullYear();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  return `RPT-${year}-${suffix}`;
}

const reportColumns = `
  r.id,
  r.reference,
  r.reporter_id AS reporterId,
  r.category,
  r.equipment_id AS equipmentId,
  e.name AS equipmentName,
  r.room_id AS roomId,
  rm.name AS roomName,
  r.location_id AS locationId,
  loc.name AS locationName,
  r.booking_id AS bookingId,
  r.issue_type AS issueType,
  r.description,
  r.attachment_ids AS attachmentIds,
  r.status,
  r.created_at AS createdAt,
  r.updated_at AS updatedAt,
  r.resolved_at AS resolvedAt
`;

function reportQuery(where = "", suffix = "") {
  return `SELECT ${reportColumns}
    FROM reports r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    LEFT JOIN rooms rm ON rm.id = r.room_id
    LEFT JOIN locations loc ON loc.id = r.location_id
    ${where}
    ORDER BY r.created_at DESC, r.id DESC${suffix}`;
}

async function getUpdates(db: ReportDatabase, reportId: number): Promise<ReportUpdateRecord[]> {
  const result = await db
    .prepare(`
      SELECT
        ru.id,
        ru.report_id AS reportId,
        ru.author_id AS authorId,
        u.full_name AS authorName,
        ru.status,
        ru.message,
        ru.created_at AS createdAt
      FROM report_updates ru
      LEFT JOIN users u ON u.id = ru.author_id
      WHERE ru.report_id = ?
      ORDER BY ru.created_at ASC, ru.id ASC
    `)
    .bind(reportId)
    .all<ReportUpdateRecord>();
  return result.results;
}

function withUpdates(row: ReportRow, updates: ReportUpdateRecord[]): ReportRecord {
  let attachmentIds: number[] = [];
  try {
    const value = typeof row.attachmentIds === "string" ? JSON.parse(row.attachmentIds) : row.attachmentIds;
    if (Array.isArray(value)) attachmentIds = value.filter((id): id is number => Number.isSafeInteger(id) && id > 0);
  } catch { attachmentIds = []; }
  return { ...row, attachmentIds, updates };
}

function reportInsertStatement(
  db: ReportDatabase,
  input: CreateReportInput,
): D1PreparedStatement {
  return db
    .prepare(`
      INSERT INTO reports
        (reference, reporter_id, category, equipment_id, room_id, location_id,
         booking_id, issue_type, description, attachment_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `)
    .bind(
      input.reference,
      input.reporterId,
      input.category,
      input.equipmentId ?? null,
      input.roomId ?? null,
      input.locationId ?? null,
      input.bookingId ?? null,
      input.issueType ?? null,
      input.description,
      JSON.stringify(input.attachmentIds ?? []),
    );
}

export async function createReport(
  db: ReportDatabase,
  input: CreateReportInput,
): Promise<ReportRecord> {
  const inserted = await reportInsertStatement(db, input).first<{ id: number }>();

  if (!inserted) throw new Error("Report could not be created.");
  const report = await getReport(db, inserted.id);
  if (!report) throw new Error("Report could not be read after creation.");
  return report;
}

export async function createReportIdempotently(
  db: ReportDatabase,
  input: CreateReportInput,
  request: IdempotencyRequest,
): Promise<Response> {
  const response = await runIdempotentBatch(db, request, [reportInsertStatement(db, input)], {
    sql: `SELECT json_object('report', json_object(
      'id', id, 'reference', reference, 'reporterId', reporterId, 'category', category,
      'equipmentId', equipmentId, 'equipmentName', equipmentName,
      'roomId', roomId, 'roomName', roomName, 'locationId', locationId, 'locationName', locationName,
      'bookingId', bookingId, 'issueType', issueType, 'description', description,
      'attachmentIds', json(attachmentIds), 'status', status, 'createdAt', createdAt,
      'updatedAt', updatedAt, 'resolvedAt', resolvedAt, 'updates', json('[]')
    )) AS response_body FROM (${reportQuery("WHERE r.reference = ?", " LIMIT 1")})`,
    bindings: [input.reference],
  });
  if (!response) throw new Error("Report could not be created.");
  return response;
}

export async function listReports(
  db: ReportDatabase,
  reporterId: number,
): Promise<ReportRecord[]> {
  const result = await db
    .prepare(reportQuery("WHERE r.reporter_id = ?"))
    .bind(reporterId)
    .all<ReportRow>();
  return result.results.map((row) => withUpdates(row, []));
}

export async function listAllReports(db: ReportDatabase): Promise<ReportRecord[]> {
  const result = await db.prepare(reportQuery()).all<ReportRow>();
  const reports = result.results.map((row) => withUpdates(row, []));
  return Promise.all(reports.map(async (report) => ({ ...report, updates: await getUpdates(db, report.id) })));
}

export async function getReport(
  db: ReportDatabase,
  reportId: number,
): Promise<ReportRecord | null> {
  const row = await db.prepare(reportQuery("WHERE r.id = ?", " LIMIT 1")).bind(reportId).first<ReportRow>();
  if (!row) return null;
  return withUpdates(row, await getUpdates(db, reportId));
}

export async function updateReport(
  db: ReportDatabase,
  reportId: number,
  authorId: number,
  update: { status?: ReportStatus; message?: string },
): Promise<ReportRecord | null> {
  const now = new Date().toISOString();
  const resolvedAt = update.status === "resolved" || update.status === "closed" ? now : null;
  const clearResolvedAt = update.status === "reopened";

  await db.batch([
    db
      .prepare(`
        UPDATE reports
        SET
          status = CASE WHEN ? IS NULL THEN status ELSE ? END,
          updated_at = ?,
          resolved_at = CASE
            WHEN ? = 1 THEN NULL
            WHEN ? IS NOT NULL THEN ?
            ELSE resolved_at
          END
        WHERE id = ?
      `)
      .bind(
        update.status ?? null,
        update.status ?? null,
        now,
        clearResolvedAt ? 1 : 0,
        resolvedAt,
        resolvedAt,
        reportId,
      ),
    db
      .prepare(`
        INSERT INTO report_updates (report_id, author_id, status, message)
        VALUES (?, ?, ?, ?)
      `)
      .bind(reportId, authorId, update.status ?? null, update.message ?? null),
  ]);

  return getReport(db, reportId);
}
