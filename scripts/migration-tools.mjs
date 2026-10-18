import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
process.env.WRANGLER_SEND_METRICS = "false";
process.env.WRANGLER_WRITE_LOGS = "false";
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");

export async function loadMigrations() {
  const directory = path.join(projectRoot, "drizzle");
  const journal = JSON.parse(await readFile(path.join(directory, "meta/_journal.json"), "utf8"));
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  if (names.length !== journal.entries.length || names.some((name, index) =>
    !/^\d{4}_[a-z0-9_]+\.sql$/.test(name) ||
    Number(name.slice(0, 4)) !== index || journal.entries[index].idx !== index ||
    name !== `${journal.entries[index].tag}.sql`)) {
    throw new Error("Migration SQL and journal must contain the same contiguous, ordered sequence starting at 0000.");
  }
  return Promise.all(names.map(async (name) => ({
    name, sql: await readFile(path.join(directory, name), "utf8"),
  })));
}

// Match Wrangler 4.92.0's local D1 identity and persistence layout. No network,
// secrets, application Worker, or real local state is needed for an in-memory DB.
export async function openMigrationDatabase({ persistTo, databaseId } = {}) {
  const config = JSON.parse(await readFile(path.join(projectRoot, "wrangler.json"), "utf8"));
  const binding = config.d1_databases.find((entry) => entry.binding === "DB");
  if (!binding || (binding.migrations_table && binding.migrations_table !== "d1_migrations") ||
    binding.migrations_dir !== "drizzle") throw new Error("Expected DB binding with drizzle/ and the default D1 ledger.");
  const emulator = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('migration inspection'); } }",
    compatibilityDate: config.compatibility_date,
    d1Databases: { DB: databaseId ?? binding.preview_database_id ?? binding.database_id ?? binding.binding },
    ...(persistTo ? { d1Persist: path.join(path.resolve(persistTo), "v3/d1") } : {}),
  });
  try {
    return { db: await emulator.getD1Database("DB"), dispose: () => emulator.dispose() };
  } catch (error) {
    await emulator.dispose();
    throw error;
  }
}

// Reference-schema/test helper only. Production application uses the Wrangler
// CLI, which splits complete SQL (including triggers) and atomically adds its ledger row.
export async function applyMigrationBatch(db, migration, { track = false } = {}) {
  const statements = migration.sql.split("--> statement-breakpoint").filter((sql) => sql.trim());
  const batch = statements.map((sql) => db.prepare(sql));
  if (track) batch.push(db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(migration.name));
  await db.batch(batch);
}

export async function readSchema(db) {
  const { results } = await db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name <> 'd1_migrations'
    ORDER BY type, name`).all();
  return results.map((row) => ({ ...row, sql: row.sql?.trim().replace(/\s+/g, " ") }));
}

export async function preflightMigrations(db, migrations) {
  migrations ??= await loadMigrations();
  const issues = [];
  const add = (code, message, rows = []) => issues.push({ code, message, rows });
  const schema = await readSchema(db);
  const tables = new Map();
  for (const { name, type } of schema) {
    if (type === "table") {
      const { results } = await db.prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all();
      tables.set(name, new Set(results.map((row) => row.name)));
    }
  }
  const has = (table, ...columns) => columns.every((column) => tables.get(table)?.has(column));
  const ledger = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").first();
  let applied = [];
  let validLedger = true;
  if (ledger) {
    const { results: columns } = await db.prepare("PRAGMA table_info(d1_migrations)").all();
    if (!["id", "name", "applied_at"].every((name) => columns.some((column) => column.name === name))) {
      validLedger = false;
      add("invalid-ledger", "d1_migrations does not have Wrangler's expected columns.");
    } else {
      const { results } = await db.prepare("SELECT id, name, applied_at FROM d1_migrations ORDER BY id").all();
      applied = results.map((row) => row.name);
      if (applied.some((name, index) => name !== migrations[index]?.name)) {
        validLedger = false;
        add("invalid-ledger", "Ledger is not an ordered prefix of the checked-in migrations (unknown, missing, duplicated, or out-of-order entries).", results);
      }
    }
  }
  if (!applied.length && schema.length) {
    add("untracked-schema", "Application schema exists without a migration ledger. Stop and review a backup; do not replay SQL or insert guessed ledger entries.");
  }
  if (validLedger) {
    const reference = await openMigrationDatabase();
    try {
      for (const migration of migrations.slice(0, applied.length)) await applyMigrationBatch(reference.db, migration);
      const expected = await readSchema(reference.db);
      const actualByKey = new Map(schema.map((row) => [`${row.type}:${row.name}`, row.sql]));
      const expectedByKey = new Map(expected.map((row) => [`${row.type}:${row.name}`, row.sql]));
      const differences = [];
      for (const [object, sql] of expectedByKey) {
        if (!actualByKey.has(object)) differences.push({ object, problem: "missing" });
        else if (actualByKey.get(object) !== sql) differences.push({ object, problem: "changed" });
      }
      for (const object of actualByKey.keys()) {
        if (!expectedByKey.has(object)) differences.push({ object, problem: "untracked" });
      }
      if (differences.length) add("schema-drift", "Schema differs from the ledger's SQL prefix: partial, untracked, or manually modified migration state.", differences);
    } finally {
      await reference.dispose();
    }
  }
  const check = async (code, message, sql) => {
    const { results } = await db.prepare(sql).all();
    if (results.length) add(code, message, results);
  };
  if (has("time_slots", "id", "room_id", "date", "start_time")) {
    await check("duplicate-slots", "Duplicate canonical room/date/start slots must be reviewed before uniqueness migrations.",
      `SELECT room_id, date, start_time, count(*) AS count, group_concat(id) AS ids
       FROM time_slots GROUP BY room_id, date, start_time HAVING count(*) > 1 LIMIT 20`);
  }
  if (has("booking_slots", "booking_id", "time_slot_id")) {
    await check("duplicate-booking-slots", "Duplicate booking-to-slot links would fail migration 0005.",
      `SELECT booking_id, time_slot_id, count(*) AS count FROM booking_slots
       GROUP BY booking_id, time_slot_id HAVING count(*) > 1 LIMIT 20`);
  }
  if (has("bookings", "id", "room_id", "date", "start_time", "end_time", "status")) {
    await check("conflicting-bookings", "Confirmed bookings overlap in the same room; an operator must resolve ownership.",
      `SELECT a.id AS booking_id, b.id AS conflicting_booking_id, a.room_id, a.date
       FROM bookings a JOIN bookings b ON a.id < b.id AND a.room_id = b.room_id AND a.date = b.date
       WHERE a.status = 'confirmed' AND b.status = 'confirmed'
         AND a.start_time < CASE b.end_time WHEN '00:00' THEN '24:00' ELSE b.end_time END
          AND b.start_time < CASE a.end_time WHEN '00:00' THEN '24:00' ELSE a.end_time END LIMIT 20`);
    if (has("bookings", "user_id")) {
      await check("overlapping-student-bookings", "One account has overlapping reservations in different rooms; resolve these before operational use.",
        `SELECT a.id AS booking_id, b.id AS conflicting_booking_id, a.user_id, a.date
         FROM bookings a JOIN bookings b ON a.id < b.id AND a.user_id = b.user_id AND a.date = b.date
         WHERE a.user_id IS NOT NULL AND a.status = 'confirmed' AND b.status = 'confirmed' AND a.room_id <> b.room_id
           AND a.start_time < CASE b.end_time WHEN '00:00' THEN '24:00' ELSE b.end_time END
           AND b.start_time < CASE a.end_time WHEN '00:00' THEN '24:00' ELSE a.end_time END LIMIT 20`);
    }
    if (has("booking_slots", "booking_id", "time_slot_id") && has("time_slots", "id", "room_id", "date", "start_time")) {
      await check("conflicting-slot-claims", "Multiple confirmed bookings claim a canonical slot; migration 0005 cannot choose a winner.",
        `SELECT s.room_id, s.date, s.start_time, group_concat(DISTINCT b.id) AS booking_ids
         FROM booking_slots bs JOIN bookings b ON b.id = bs.booking_id JOIN time_slots s ON s.id = bs.time_slot_id
         WHERE b.status = 'confirmed' GROUP BY s.room_id, s.date, s.start_time
         HAVING count(DISTINCT b.id) > 1 LIMIT 20`);
    }
  }
  if (has("rooms", "id", "code") && has("locations", "id", "code")) {
    await check("unmapped-room-locations", "Rooms lack a verified location mapping; 0006 only backfills matching location codes.",
      has("rooms", "location_id")
        ? `SELECT r.id, r.code, r.location_id FROM rooms r LEFT JOIN locations l ON l.id = r.location_id WHERE l.id IS NULL LIMIT 20`
        : `SELECT r.id, r.code FROM rooms r LEFT JOIN locations l ON l.code = r.code WHERE l.id IS NULL LIMIT 20`);
  }
  if (!applied.includes("0003_amusing_nekra.sql")) {
    if (has("reports", "id", "category", "status")) {
      await check("invalid-report-values", "0003 adds report category/status constraints. Review incompatible legacy values before migration; no values are rewritten.",
        `SELECT id, category, status FROM reports
         WHERE category IS NULL OR category NOT IN ('equipment', 'room', 'assistance')
            OR status IS NULL OR status NOT IN ('open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'reopened') LIMIT 20`);
    }
    if (has("report_updates", "id", "report_id", "status")) {
      await check("invalid-report-update-status", "0003 adds a history-status constraint. Review incompatible legacy values before migration; NULL history statuses remain supported.",
        `SELECT id, report_id, status FROM report_updates
         WHERE status IS NOT NULL AND status NOT IN ('open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'reopened') LIMIT 20`);
    }
  }
  await check("foreign-key-violations", "Existing foreign-key violations require operator review.", "PRAGMA foreign_key_check");
  return {
    ok: issues.length === 0,
    applied,
    pending: validLedger ? migrations.slice(applied.length).map((migration) => migration.name) : [],
    issues,
  };
}
