export interface IdempotencyDatabase {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface IdempotencyRequest {
  readonly actorUserId: number;
  readonly operation: string;
  readonly requestKey: string;
  readonly requestHash: string;
}

interface ReplayRecord {
  requestHash: string;
  statusCode: number;
  responseBody: string;
}

export class IdempotencyError extends Error {
  readonly status: 400 | 409;
  readonly code: string;

  constructor(message: string, status: 400 | 409, code: string) {
    super(message);
    this.name = "IdempotencyError";
    this.status = status;
    this.code = code;
  }
}

export async function hashRequest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareIdempotencyRequest(
  actorUserId: number,
  operation: string,
  requestKey: string | null,
  body: unknown,
): Promise<IdempotencyRequest | null> {
  if (requestKey === null) return null;
  if (requestKey.length < 8 || requestKey.length > 200 || /[^A-Za-z0-9._:-]/.test(requestKey)) {
    throw new IdempotencyError("Idempotency-Key must be 8-200 ASCII characters using letters, digits, '.', '_', ':', or '-'.", 400, "IDEMPOTENCY_KEY_INVALID");
  }
  return { actorUserId, operation, requestKey, requestHash: await hashRequest(body) };
}

function keyBindings(request: IdempotencyRequest): [number, string, string] {
  return [request.actorUserId, request.operation, request.requestKey];
}

function cleanupExpiredRecord(db: IdempotencyDatabase, request: IdempotencyRequest): D1PreparedStatement {
  // Scope cleanup to the indexed key; NULL expiry denotes a non-expiring record.
  return db.prepare(`DELETE FROM idempotency_records
    WHERE actor_user_id = ? AND operation = ? AND request_key = ?
      AND expires_at IS NOT NULL AND julianday(expires_at) <= julianday('now')`).bind(...keyBindings(request));
}

function selectRecord(db: IdempotencyDatabase, request: IdempotencyRequest): D1PreparedStatement {
  return db.prepare(`SELECT request_hash AS requestHash, status_code AS statusCode, response_body AS responseBody
    FROM idempotency_records WHERE actor_user_id = ? AND operation = ? AND request_key = ?
      AND (expires_at IS NULL OR julianday(expires_at) > julianday('now')) LIMIT 1`).bind(...keyBindings(request));
}

function recordResponse(row: ReplayRecord | undefined, request: IdempotencyRequest, replay: boolean): Response | null {
  if (!row) return null;
  if (row.requestHash !== request.requestHash) {
    throw new IdempotencyError("This idempotency key was already used with a different request.", 409, "IDEMPOTENCY_MISMATCH");
  }
  return new Response(row.responseBody, {
    status: row.statusCode,
    headers: { "Content-Type": "application/json", ...(replay ? { "Idempotent-Replay": "true" } : {}) },
  });
}

export async function replayIdempotentResponse(db: IdempotencyDatabase, request: IdempotencyRequest | null): Promise<Response | null> {
  if (!request) return null;
  const [, result] = await db.batch<ReplayRecord>([cleanupExpiredRecord(db, request), selectRecord(db, request)]);
  return recordResponse(result.results[0], request, true);
}

/**
 * responseQuery must select one JSON response_body for a successful mutation,
 * or no rows when the mutation made no changes (e.g. unavailable booking slots).
 * Its reads, all business writes, expiry cleanup, and the strict unique INSERT
 * run in ONE D1 transaction. Never use OR IGNORE here: a key race must roll back
 * the losing business writes before returning the winner's recorded response.
 */
export async function runIdempotentBatch(
  db: IdempotencyDatabase,
  request: IdempotencyRequest,
  mutations: D1PreparedStatement[],
  responseQuery: { sql: string; bindings: (string | number | null)[] },
  remainingMutations: D1PreparedStatement[] = [],
): Promise<Response | null> {
  const remember = db.prepare(`
    INSERT INTO idempotency_records
      (actor_user_id, operation, request_key, request_hash, status_code, response_body, expires_at)
    SELECT ?, ?, ?, ?, ?, response_body, datetime('now', '+2 days') FROM (${responseQuery.sql})
    RETURNING request_hash AS requestHash, status_code AS statusCode, response_body AS responseBody
  `).bind(...keyBindings(request), request.requestHash, 201, ...responseQuery.bindings);
  let results: D1Result<ReplayRecord>[];
  try {
    results = await db.batch<ReplayRecord>([
      cleanupExpiredRecord(db, request), ...mutations, remember, ...remainingMutations, selectRecord(db, request),
    ]);
  } catch (error) {
    // D1 has already rolled back the entire batch. This also handles a lost
    // acknowledgement after commit without repeating the business mutation.
    const replay = await replayIdempotentResponse(db, request);
    if (replay) return replay;
    throw error;
  }
  const inserted = results[mutations.length + 1].results[0];
  // A booking race can make the INSERT a no-op due to unavailable slots. The
  // final SELECT still finds a winning same-key request inside the batch.
  return recordResponse(inserted ?? results[results.length - 1].results[0], request, !inserted);
}
