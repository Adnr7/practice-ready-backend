import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { getInstitutionNow } from "../lib/booking-engine.ts";
import { reserveSlotsIdempotently } from "../lib/booking-store.ts";
import { createReportIdempotently, getReport, updateReport } from "../lib/report-store.ts";
import { prepareIdempotencyRequest, replayIdempotentResponse } from "../lib/idempotency.ts";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const migrations = [
  "0000_lush_misty_knight.sql", "0001_new_the_hood.sql", "0002_open_layla_miller.sql",
  "0003_amusing_nekra.sql", "0004_equipment_movements.sql", "0005_reservation_lifecycle.sql",
  "0006_room_readiness.sql", "0007_frontend_workflows.sql",
];
const date = getInstitutionNow(Date.now() + 2 * 86_400_000).date;
const bookingBody = { roomId: 1, date, startTime: "09:00", endTime: "10:00" };
const reportBody = { category: "assistance", description: "Please help connect a practice-room cable." };

describe("atomic Idempotency-Key creation through the Worker routes", () => {
  let emulator;
  let db;

  before(async () => {
    // Keep the real handlers and Drizzle. Inject authenticated fixture actors at
    // the auth boundary so this suite needs exactly migrations 0000-0007, even
    // when session persistence is changed independently in later migrations.
    const bundle = await build({
      stdin: {
        contents: `
          import { POST as book } from './app/api/bookings/route.ts';
          import { POST as report } from './app/api/reports/route.ts';
          export default { fetch(request) {
            // The dispatchFetch HTTP transport drops empty-valued headers.
            if (request.headers.has('X-Test-Empty-Key')) {
              request = new Request(request);
              request.headers.set('Idempotency-Key', '');
            }
            return new URL(request.url).pathname === '/api/bookings' ? book(request) : report(request);
          } };
        `,
        resolveDir: fileURLToPath(new URL("..", import.meta.url)),
        sourcefile: "idempotency-test-worker.ts",
        loader: "ts",
      },
      bundle: true, write: false, format: "esm", platform: "neutral",
      external: ["cloudflare:workers"],
      plugins: [{
        name: "fixture-actors",
        setup(plugin) {
          plugin.onLoad({ filter: /[/\\]lib[/\\]auth\.ts$/ }, () => ({
            loader: "ts",
            contents: `
              export function configureAuthSecret() {}
              export async function getSessionFromRequest(request) {
                const userId = Number(request.headers.get('X-Test-Actor'));
                return [1, 2].includes(userId) ? { userId, role: 'student' } : null;
              }
            `,
          }));
        },
      }],
    });
    emulator = new Miniflare({
      modules: true, script: bundle.outputFiles[0].text,
      compatibilityDate: "2026-05-15", d1Databases: ["DB"],
    });
    db = await emulator.getD1Database("DB");
    for (const file of migrations) {
      const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint").filter((sql) => sql.trim())) {
        await db.prepare(statement).run();
      }
    }
    await db.batch([
      ...[1, 2].map((id) => db.prepare(`INSERT INTO users (id, email, password_hash, salt, full_name, role)
        VALUES (?, ?, 'unused-test-placeholder', 'unused-test-placeholder', 'Fixture', 'student')`)
        .bind(id, `fixture-${id}@example.invalid`)),
      db.prepare("INSERT INTO rooms (id, name, code, capacity, description) VALUES (1, 'MPR 2', 'mpr-2', 6, 'Test')"),
    ]);
  });
  after(async () => { await emulator?.dispose(); });
  beforeEach(async () => {
    await db.batch([
      db.prepare("DROP TRIGGER IF EXISTS fail_replay_write"),
      db.prepare("DROP TRIGGER IF EXISTS fail_business_write"),
      db.prepare("DELETE FROM idempotency_records"),
      db.prepare("DELETE FROM room_closures"),
      db.prepare("DELETE FROM reports"),
      db.prepare("DELETE FROM attachments"),
      db.prepare("DELETE FROM bookings"),
      db.prepare("DELETE FROM time_slots"),
      db.prepare("UPDATE rooms SET name = 'MPR 2', code = 'mpr-2', is_active = 1, readiness_state = 'usable'"),
      db.prepare("UPDATE booking_policies SET maximum_minutes = 180, advance_days = 14"),
    ]);
  });

  async function post(kind, body, key, userId = 1) {
    const headers = { "Content-Type": "application/json" };
    if (userId) headers["X-Test-Actor"] = String(userId);
    if (key !== undefined) headers["Idempotency-Key"] = key;
    if (key === "") headers["X-Test-Empty-Key"] = "1";
    return emulator.dispatchFetch(`http://example.invalid/api/${kind}`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
  }
  const count = (table) => db.prepare(`SELECT count(*) AS count FROM ${table}`).first("count");

  async function seedSlots() {
    await db.prepare(`INSERT INTO time_slots (room_id, date, period, start_time, end_time) VALUES
      (1, ?, 'morning', '09:00', '09:30'), (1, ?, 'morning', '09:30', '10:00'),
      (1, ?, 'morning', '10:00', '10:30'), (1, ?, 'morning', '10:30', '11:00')`)
      .bind(date, date, date, date).run();
  }

  async function store(kind, body, request, suffix) {
    if (kind === "reports") {
      return createReportIdempotently(db, { ...body, reporterId: 1, reference: `RPT-DIRECT-${suffix}` }, request);
    }
    const startHour = Number(body.startTime.slice(0, 2));
    return reserveSlotsIdempotently(db, {
      ...body, userId: 1, guestStudentName: null, guestStudentId: null,
      bookingRef: `PR-DIRECT-${suffix}`, durationMinutes: 60, policyVersion: "2026-10-pilot",
    }, [`${startHour.toString().padStart(2, "0")}:00`, `${startHour.toString().padStart(2, "0")}:30`], request, "Fixture room");
  }

  for (const [kind, body, table, field] of [
    ["reports", reportBody, "reports", "report"],
    ["bookings", bookingBody, "bookings", "booking"],
  ]) {
    it(`${kind} atomically handle two guaranteed replay misses`, async () => {
      if (kind === "bookings") await seedSlots();
      const operation = kind === "reports" ? "report.create" : "booking.create";
      const request = await prepareIdempotencyRequest(1, operation, "preflight-miss-key", body);
      assert.deepEqual(await Promise.all([
        replayIdempotentResponse(db, request), replayIdempotentResponse(db, request),
      ]), [null, null]);
      // Both writes run even if one wins before the other starts its batch.
      // This forces the uniqueness/slot-conflict path independently of timing.
      const responses = await Promise.all([
        store(kind, body, request, "FIRST"), store(kind, body, request, "SECOND"),
      ]);
      assert.deepEqual(responses.map((response) => response.status), [201, 201]);
      assert.equal(await responses[0].text(), await responses[1].text());
      assert.equal(responses.filter((response) => response.headers.get("Idempotent-Replay") === "true").length, 1);
      assert.equal(await count(table), 1);
      assert.equal(await count("idempotency_records"), 1);
    });

    it(`concurrent changed-input ${kind} roll back the losing mutation`, async () => {
      if (kind === "bookings") await seedSlots();
      const operation = kind === "reports" ? "report.create" : "booking.create";
      const changed = kind === "reports" ? { ...body, description: "A competing request with different input." }
        : { ...body, startTime: "10:00", endTime: "11:00" };
      const requests = await Promise.all([body, changed].map((input) =>
        prepareIdempotencyRequest(1, operation, "racing-mismatch-key", input)));
      assert.deepEqual(await Promise.all(requests.map((request) => replayIdempotentResponse(db, request))), [null, null]);
      const results = await Promise.allSettled([
        store(kind, body, requests[0], "FIRST"), store(kind, changed, requests[1], "SECOND"),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const failure = results.find((result) => result.status === "rejected").reason;
      assert.equal(failure.status, 409);
      assert.equal(failure.code, "IDEMPOTENCY_MISMATCH");
      assert.equal(await count(table), 1);
      assert.equal(await count("idempotency_records"), 1);
      if (kind === "bookings") {
        assert.equal(await count("booking_claims"), 2);
        assert.equal(await count("booking_slots"), 2);
        assert.equal(await db.prepare("SELECT count(*) FROM time_slots WHERE status = 'available'").first("count(*)"), 2);
      }
    });

    it(`concurrent same-key ${kind} return one creation and identical replays`, async () => {
      const responses = await Promise.all(Array.from({ length: 6 }, () => post(kind, body, "concurrent-key")));
      assert.deepEqual(responses.map((response) => response.status), Array(6).fill(201));
      const bodies = await Promise.all(responses.map((response) => response.text()));
      assert.equal(new Set(bodies).size, 1, "replay must preserve the exact original response");
      assert.equal(responses.filter((response) => response.headers.get("Idempotent-Replay") === "true").length, 5);
      assert.equal(await count(table), 1);
      assert.equal(await count("idempotency_records"), 1);
      if (kind === "bookings") {
        assert.equal(await count("booking_claims"), 2);
        assert.equal(await count("booking_slots"), 2);
      }
    });

    it(`${kind} reject a reused key with changed input`, async () => {
      assert.equal((await post(kind, body, "mismatch-key")).status, 201);
      const changed = kind === "reports" ? { ...body, description: "A different assistance request." }
        : { ...body, startTime: "10:00", endTime: "11:00" };
      const response = await post(kind, changed, "mismatch-key");
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "IDEMPOTENCY_MISMATCH");
      assert.equal(await count(table), 1);
    });

    it(`${kind} roll back business writes if replay persistence fails, then allow retry`, async () => {
      await db.prepare(`CREATE TRIGGER fail_replay_write BEFORE INSERT ON idempotency_records
        BEGIN SELECT RAISE(ABORT, 'injected replay persistence failure'); END`).run();
      assert.equal((await post(kind, body, "rollback-key")).status, 500);
      assert.equal(await count(table), 0);
      assert.equal(await count("idempotency_records"), 0);
      if (kind === "bookings") {
        assert.equal(await count("booking_claims"), 0);
        assert.equal(await count("booking_slots"), 0);
        assert.equal(await db.prepare("SELECT count(*) FROM time_slots WHERE status = 'booked'").first("count(*)"), 0);
      }
      await db.prepare("DROP TRIGGER fail_replay_write").run();
      assert.equal((await post(kind, body, "rollback-key")).status, 201);
      assert.equal(await count(table), 1);
      assert.equal(await count("idempotency_records"), 1);
    });

    it(`${kind} do not retain replay state after a business-write failure`, async () => {
      const target = kind === "bookings" ? "booking_slots" : "reports";
      await db.prepare(`CREATE TRIGGER fail_business_write BEFORE INSERT ON ${target}
        BEGIN SELECT RAISE(ABORT, 'injected business failure'); END`).run();
      assert.equal((await post(kind, body, "business-failure-key")).status, 500);
      assert.equal(await count(table), 0);
      assert.equal(await count("idempotency_records"), 0);
      if (kind === "bookings") {
        assert.equal(await count("booking_claims"), 0);
        assert.equal(await count("booking_slots"), 0);
        assert.equal(await db.prepare("SELECT count(*) FROM time_slots WHERE status = 'booked'").first("count(*)"), 0);
      }
      await db.prepare("DROP TRIGGER fail_business_write").run();
      assert.equal((await post(kind, body, "business-failure-key")).status, 201);
    });

    it(`${kind} clean up an expired record and allow changed-input key reuse`, async () => {
      const first = await (await post(kind, body, "expired-key")).json();
      // Exercise both SQLite timestamps and ISO timestamps with fractional seconds.
      if (kind === "reports") {
        await db.prepare("UPDATE idempotency_records SET expires_at = ?").bind(new Date(Date.now() - 60_000).toISOString()).run();
      } else {
        await db.prepare("UPDATE idempotency_records SET expires_at = datetime('now', '-1 second')").run();
      }
      const changed = kind === "reports" ? { ...body, description: "A new request after expiry." }
        : { ...body, startTime: "10:00", endTime: "11:00" };
      const response = await post(kind, changed, "expired-key");
      assert.equal(response.status, 201);
      assert.equal(response.headers.get("Idempotent-Replay"), null);
      assert.notEqual((await response.json())[field].id, first[field].id);
      assert.equal(await count(table), 2);
      assert.equal(await count("idempotency_records"), 1);
      assert.equal(await db.prepare("SELECT count(*) FROM idempotency_records WHERE julianday(expires_at) <= julianday('now')").first("count(*)"), 0);
    });

    it(`${kind} return 400 for invalid keys without creating anything`, async () => {
      for (const key of ["", "short", "invalid key", "non-ascii-é", "x".repeat(201)]) {
        const response = await post(kind, body, key);
        assert.equal(response.status, 400, `invalid key: ${JSON.stringify(key)}`);
        assert.equal((await response.json()).code, "IDEMPOTENCY_KEY_INVALID");
      }
      assert.equal(await count(table), 0);
      assert.equal(await count("idempotency_records"), 0);
    });
  }

  it("does not consume a booking key on an availability conflict", async () => {
    assert.equal((await post("bookings", bookingBody)).status, 201);
    assert.equal((await post("bookings", bookingBody, "available-later-key")).status, 409);
    assert.equal(await count("idempotency_records"), 0);
    const adjacent = { ...bookingBody, startTime: "10:00", endTime: "11:00" };
    assert.equal((await post("bookings", adjacent, "available-later-key")).status, 201);
    assert.equal(await count("bookings"), 2);
    assert.equal(await count("idempotency_records"), 1);
  });

  it("scopes the same key by both actor and operation", async () => {
    const own = await (await post("reports", reportBody, "scoped-key", 1)).json();
    const other = await (await post("reports", reportBody, "scoped-key", 2)).json();
    assert.equal(own.report.reporterId, 1);
    assert.equal(other.report.reporterId, 2);
    assert.notEqual(own.report.id, other.report.id);
    assert.equal((await post("bookings", bookingBody, "scoped-key", 1)).status, 201);
    assert.equal(await count("idempotency_records"), 3);
  });

  it("replays the original report snapshot before mutable context and attachment validation", async () => {
    const attachment = await db.prepare(`INSERT INTO attachments
      (owner_user_id, file_name, media_type, byte_size, data_url)
      VALUES (1, 'fixture.png', 'image/png', 3, 'data:image/png;base64,AAAA') RETURNING id`).first();
    const body = { category: "room", roomId: 1, issueType: "maintenance", description: "A test room issue.", attachmentIds: [attachment.id] };
    const original = await post("reports", body, "snapshot-key");
    assert.equal(original.status, 201);
    const snapshot = await original.text();
    const { report } = JSON.parse(snapshot);
    assert.deepEqual(report, await getReport(db, report.id), "keyed report shape must match the existing API");
    await updateReport(db, report.id, 1, { status: "resolved", message: "Fixture update." });
    await db.batch([
      db.prepare("UPDATE rooms SET name = 'Renamed room'"),
      db.prepare("UPDATE attachments SET owner_user_id = 2 WHERE id = ?").bind(attachment.id),
    ]);
    const replay = await post("reports", body, "snapshot-key");
    assert.equal(replay.status, 201);
    assert.equal(await replay.text(), snapshot);
    assert.equal((await post("reports", body, "fresh-snapshot-key")).status, 403);
    assert.equal((await post("reports", body, "snapshot-key", null)).status, 401);
    assert.equal((await post("reports", { ...body, description: "" }, "snapshot-key")).status, 400);
  });

  it("honors non-expiring replay records", async () => {
    const original = await post("reports", reportBody, "no-expiration-key");
    assert.equal(original.status, 201);
    await db.prepare("UPDATE idempotency_records SET expires_at = NULL").run();
    const replay = await post("reports", reportBody, "no-expiration-key");
    assert.equal(replay.headers.get("Idempotent-Replay"), "true");
    assert.equal(await replay.text(), await original.text());
    assert.equal(await count("reports"), 1);
  });

  for (const condition of ["closure", "policy", "inactive room"]) {
    it(`replays a booking before mutable ${condition} validation`, async () => {
      const original = await post("bookings", bookingBody, "validation-order-key");
      assert.equal(original.status, 201);
      const originalBody = await original.text();
      if (condition === "closure") {
        await db.prepare("UPDATE rooms SET readiness_state = 'closed'").run();
      } else if (condition === "policy") {
        await db.prepare("UPDATE booking_policies SET maximum_minutes = 30").run();
      } else {
        await db.prepare("UPDATE rooms SET is_active = 0").run();
      }
      const replay = await post("bookings", bookingBody, "validation-order-key");
      assert.equal(replay.status, 201);
      assert.equal(replay.headers.get("Idempotent-Replay"), "true");
      assert.equal(await replay.text(), originalBody);
      assert.notEqual((await post("bookings", bookingBody, "new-validation-key")).status, 201);
      assert.equal((await post("bookings", bookingBody, "validation-order-key", null)).status, 401);
      assert.equal((await post("bookings", { ...bookingBody, date: "not-a-date" }, "validation-order-key")).status, 400);
    });
  }

  it("preserves no-key report creation and booking conflict behavior", async () => {
    assert.equal((await post("reports", reportBody)).status, 201);
    assert.equal((await post("reports", reportBody)).status, 201);
    assert.equal((await post("bookings", bookingBody)).status, 201);
    assert.equal((await post("bookings", bookingBody)).status, 409);
    assert.equal(await count("reports"), 2);
    assert.equal(await count("bookings"), 1);
    assert.equal(await count("idempotency_records"), 0);
  });
});
