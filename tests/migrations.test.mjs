import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyMigrationBatch, loadMigrations, openMigrationDatabase, preflightMigrations, projectRoot, readSchema } from "../scripts/migration-tools.mjs";

const migrations = await loadMigrations();
const ledgerSQL = `CREATE TABLE d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;
const env = { ...process.env, CI: "true", CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" };

function cli(args) {
  return spawnSync(process.execPath, args, { cwd: projectRoot, env, encoding: "utf8", timeout: 120_000 });
}

async function fixture(count, callback, { track = true } = {}) {
  const connection = await openMigrationDatabase();
  try {
    if (track) await connection.db.prepare(ledgerSQL).run();
    for (const migration of migrations.slice(0, count)) await applyMigrationBatch(connection.db, migration, { track });
    await callback(connection.db);
  } finally { await connection.dispose(); }
}

async function reportSnapshot(db) {
  return {
    reports: (await db.prepare("SELECT * FROM reports ORDER BY id").all()).results,
    updates: (await db.prepare("SELECT * FROM report_updates ORDER BY id").all()).results,
    sequences: (await db.prepare("SELECT name, seq FROM sqlite_sequence WHERE name IN ('reports', 'report_updates') ORDER BY name").all()).results,
    ledger: (await db.prepare("SELECT * FROM d1_migrations ORDER BY id").all()).results,
    schema: await readSchema(db),
  };
}

async function populatedReportUpgrade(callback) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "practice-ready-report-upgrade-"));
  try {
    const directory = path.join(temporary, "sql");
    await mkdir(directory);
    const config = path.join(temporary, "wrangler.json");
    const persistTo = path.join(temporary, "state");
    const databaseId = "populated-report-upgrade-test";
    await writeFile(config, JSON.stringify({ name: "populated-report-upgrade-test", compatibility_date: "2026-05-15",
      d1_databases: [{ binding: "DB", database_name: databaseId, database_id: databaseId, migrations_dir: "sql" }] }));
    const migration = migrations.find((entry) => entry.name === "0003_amusing_nekra.sql");
    await writeFile(path.join(directory, migration.name), migration.sql);
    const withDb = async (inspect) => {
      const connection = await openMigrationDatabase({ persistTo, databaseId });
      try { return await inspect(connection.db); }
      finally { await connection.dispose(); }
    };
    await withDb(async (db) => {
      await db.prepare(ledgerSQL).run();
      for (const entry of migrations.slice(0, 3)) await applyMigrationBatch(db, entry, { track: true });
      assert.equal(await db.prepare("PRAGMA foreign_keys").first("foreign_keys"), 1);
      await db.batch([
        db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name) VALUES (1, 'reporter@example.invalid', 'test', 'test', 'Reporter'), (2, 'author@example.invalid', 'test', 'test', 'Author')"),
        db.prepare("INSERT INTO locations (id, code, name, type) VALUES (1, 'mpr-test', 'Test room', 'room')"),
        db.prepare("INSERT INTO rooms (id, name, code, capacity, description) VALUES (1, 'Test room', 'mpr-test', 4, 'Test')"),
        db.prepare("INSERT INTO equipment (id, equipment_id, name, type, current_location_id, default_location_id, default_room_id) VALUES (1, 'EQ-1', 'Test keyboard', 'keyboard', 1, 1, 1)"),
        db.prepare("INSERT INTO bookings (id, booking_ref, user_id, room_id, date, start_time, end_time, duration_minutes) VALUES (1, 'BOOKING-1', 1, 1, '2099-01-01', '09:00', '10:00', 60)"),
      ]);
      const statuses = ["open", "acknowledged", "in_progress", "resolved", "closed", "reopened"];
      for (const [index, status] of statuses.entries()) {
        const id = (index + 1) * 11;
        await db.prepare(`INSERT INTO reports
          (id, reference, reporter_id, category, equipment_id, room_id, location_id, booking_id,
           issue_type, description, status, created_at, updated_at, resolved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          id, `REPORT-${id}`, index % 2 + 1, ["equipment", "room", "assistance"][index % 3],
          index % 2 ? null : 1, index % 3 ? 1 : null, index % 2 ? 1 : null, index % 2 ? null : 1,
          index % 2 ? null : " cable's noise\n", ` Report ${index}: 🥁\n  preserve whitespace ' `, status,
          `2026-09-0${index + 1} 01:02:03`, `2026-10-0${index + 1} 04:05:06`,
          ["resolved", "closed"].includes(status) ? "2026-10-10 07:08:09" : null,
        ).run();
        await db.prepare(`INSERT INTO report_updates (id, report_id, author_id, status, message, created_at)
          VALUES (?, ?, 2, ?, ?, ?), (?, ?, 1, NULL, ?, ?)`).bind(
          100 + index * 10, id, status, index % 2 ? null : ` History ${index}\n  author's note 🎹 `,
          `2026-10-0${index + 1} 10:11:12`, 102 + index * 10, id, index % 2 ? "" : null,
          `2026-10-0${index + 1} 13:14:15`,
        ).run();
      }
      // AUTOINCREMENT must not reuse previously issued IDs, even if the highest
      // report/history rows were deleted before the rebuild.
      await db.batch([
        db.prepare("INSERT INTO reports (id, reference, reporter_id, category, description) VALUES (900, 'DELETED-REPORT', 1, 'room', 'Deleted')"),
        db.prepare("DELETE FROM reports WHERE id = 900"),
        db.prepare("INSERT INTO report_updates (id, report_id, author_id) VALUES (950, 11, 1)"),
        db.prepare("DELETE FROM report_updates WHERE id = 950"),
      ]);
    });
    await callback({
      withDb,
      apply: () => cli(["node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--local", "--config", config, "--persist-to", persistTo]),
    });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

describe("offline D1 migrations", () => {
  it("applies the full migration sequence with the real Wrangler CLI once and reruns without changing schema, ledger or data", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "practice-ready-migrations-"));
    try {
      const persistTo = path.join(temporary, "state");
      const first = cli(["scripts/migrate.mjs", "apply", "--persist-to", persistTo]);
      assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
      let connection = await openMigrationDatabase({ persistTo });
      let snapshot;
      let ledger;
      try {
        snapshot = await readSchema(connection.db);
        ledger = (await connection.db.prepare("SELECT * FROM d1_migrations ORDER BY id").all()).results;
        assert.deepEqual(ledger.map((row) => row.name), migrations.map((migration) => migration.name));
        assert.ok(snapshot.some((row) => row.name === "sessions"));
        assert.equal(await connection.db.prepare("SELECT count(*) AS count FROM practice_profiles").first("count"), 4);
        assert.equal(await connection.db.prepare("SELECT count(*) AS count FROM booking_policies").first("count"), 1);
        await connection.db.prepare("INSERT INTO users (email, password_hash, salt, full_name) VALUES ('migration@example.invalid', 'test', 'test', 'Preserved User')").run();
      } finally { await connection.dispose(); }
      const rerun = cli(["scripts/migrate.mjs", "apply", "--persist-to", persistTo]);
      assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
      assert.match(rerun.stdout, /No migrations to apply/);
      connection = await openMigrationDatabase({ persistTo });
      try {
        assert.deepEqual(await readSchema(connection.db), snapshot);
        assert.deepEqual((await connection.db.prepare("SELECT * FROM d1_migrations ORDER BY id").all()).results, ledger);
        assert.equal(await connection.db.prepare("SELECT full_name FROM users").first("full_name"), "Preserved User");
        assert.equal(await connection.db.prepare("SELECT count(*) AS count FROM practice_requirements").first("count"), 10);
      } finally { await connection.dispose(); }
      const preflight = cli(["scripts/migrate.mjs", "preflight", "--persist-to", persistTo, "--json"]);
      assert.equal(preflight.status, 0, preflight.stderr);
      assert.equal(JSON.parse(preflight.stdout).pending.length, 0);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });

  it("rolls a failed Wrangler migration back together with its ledger row", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "practice-ready-rollback-"));
    try {
      const directory = path.join(temporary, "sql");
      await mkdir(directory);
      const config = path.join(temporary, "wrangler.json");
      const persistTo = path.join(temporary, "state");
      const databaseId = "migration-rollback-test";
      await writeFile(config, JSON.stringify({ name: "migration-rollback-test", compatibility_date: "2026-05-15",
        d1_databases: [{ binding: "DB", database_name: "migration-rollback-test", database_id: databaseId, migrations_dir: "sql" }] }));
      await writeFile(path.join(directory, "0000_first.sql"), "CREATE TABLE preserved (id INTEGER PRIMARY KEY); INSERT INTO preserved VALUES (1);");
      await writeFile(path.join(directory, "0001_failure.sql"), "CREATE TABLE should_rollback (id INTEGER PRIMARY KEY); INSERT INTO should_rollback VALUES (1); INSERT INTO should_rollback VALUES (1);");
      const result = cli(["node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--local", "--config", config, "--persist-to", persistTo]);
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /UNIQUE constraint failed/);
      const connection = await openMigrationDatabase({ persistTo, databaseId });
      try {
        assert.deepEqual((await connection.db.prepare("SELECT name FROM d1_migrations ORDER BY id").all()).results, [{ name: "0000_first.sql" }]);
        assert.equal(await connection.db.prepare("SELECT count(*) AS count FROM preserved").first("count"), 1);
        assert.equal(await connection.db.prepare("SELECT name FROM sqlite_master WHERE name = 'should_rollback'").first(), null);
      } finally { await connection.dispose(); }
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });

  it("preserves every report/history column, ID and AUTOINCREMENT high-water mark in a populated Wrangler 0003 upgrade with foreign keys ON", async () => {
    await populatedReportUpgrade(async ({ withDb, apply }) => {
      const before = await withDb(reportSnapshot);
      assert.equal(before.reports.length, 6);
      assert.equal(before.updates.length, 12);
      assert.equal((await withDb((db) => preflightMigrations(db, migrations.slice(0, 4)))).ok, true);
      const result = apply();
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const after = await withDb(async (db) => {
        assert.equal(await db.prepare("PRAGMA foreign_keys").first("foreign_keys"), 1);
        assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
        assert.equal((await preflightMigrations(db, migrations.slice(0, 4))).ok, true);
        return reportSnapshot(db);
      });
      assert.deepEqual(after.reports, before.reports);
      assert.deepEqual(after.updates, before.updates);
      assert.deepEqual(after.sequences, before.sequences);
      assert.deepEqual(after.ledger.slice(0, 3), before.ledger);
      assert.equal(after.ledger[3].name, "0003_amusing_nekra.sql");
      const rerun = apply();
      assert.equal(rerun.status, 0, `${rerun.stdout}\n${rerun.stderr}`);
      assert.match(rerun.stdout, /No migrations to apply/);
      assert.deepEqual(await withDb(reportSnapshot), after);
      await withDb(async (db) => {
        await assert.rejects(db.prepare("INSERT INTO report_updates (report_id, author_id) VALUES (99999, 1)").run(), /FOREIGN KEY constraint failed/);
        await assert.rejects(db.prepare("UPDATE reports SET status = 'invalid-status' WHERE id = 11").run(), /CHECK constraint failed/);
        await assert.rejects(db.prepare("UPDATE reports SET category = 'invalid-category' WHERE id = 11").run(), /CHECK constraint failed/);
        await assert.rejects(db.prepare("UPDATE report_updates SET status = 'invalid-status' WHERE id = 100").run(), /CHECK constraint failed/);
        assert.equal(await db.prepare("INSERT INTO reports (reference, reporter_id, category, description) VALUES ('AFTER-UPGRADE', 1, 'room', 'New') RETURNING id").first("id"), 901);
        assert.equal(await db.prepare("INSERT INTO report_updates (report_id, author_id) VALUES (901, 1) RETURNING id").first("id"), 951);
        await db.prepare("DELETE FROM reports WHERE id = 901").run();
        assert.equal(await db.prepare("SELECT id FROM report_updates WHERE id = 951").first(), null);
      });
    });
  });

  it("rejects untracked legacy state and reports duplicates, overlapping bookings, slot claims and missing location mappings without modifying data", async () => {
    await fixture(1, async (db) => {
      await db.prepare("INSERT INTO rooms (id, name, code, capacity, description) VALUES (1, 'Legacy room', 'unmapped', 1, 'Test')").run();
      await db.prepare(`INSERT INTO time_slots (id, room_id, date, period, start_time, end_time) VALUES
        (1, 1, '2099-01-01', 'morning', '09:00', '09:30'), (2, 1, '2099-01-01', 'morning', '09:00', '09:30')`).run();
      await db.prepare(`INSERT INTO bookings (id, booking_ref, room_id, date, start_time, end_time, duration_minutes) VALUES
        (1, 'LEGACY-1', 1, '2099-01-01', '09:00', '10:00', 60), (2, 'LEGACY-2', 1, '2099-01-01', '09:30', '10:30', 60)`).run();
      await db.prepare("INSERT INTO booking_slots (booking_id, time_slot_id) VALUES (1, 1), (1, 1), (2, 2)").run();
      const before = await readSchema(db);
      const report = await preflightMigrations(db, migrations);
      assert.equal(report.ok, false);
      const codes = report.issues.map((issue) => issue.code);
      for (const code of ["untracked-schema", "schema-drift", "duplicate-slots", "duplicate-booking-slots", "conflicting-bookings", "conflicting-slot-claims", "unmapped-room-locations"]) assert.ok(codes.includes(code), code);
      assert.deepEqual(await readSchema(db), before);
      assert.equal(await db.prepare("SELECT count(*) AS count FROM booking_slots").first("count"), 3);
      assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'd1_migrations'").first(), null);
    }, { track: false });
  });

  it("detects holes and unknown ledger entries", async () => {
    await fixture(2, async (db) => {
      await db.prepare("DELETE FROM d1_migrations WHERE name = ?").bind(migrations[0].name).run();
      await db.prepare("INSERT INTO d1_migrations (name) VALUES ('0099_unknown.sql')").run();
      const report = await preflightMigrations(db, migrations);
      assert.equal(report.ok, false);
      assert.ok(report.issues.some((issue) => issue.code === "invalid-ledger"));
    });
  });

  for (const { table, column, id, value, code } of [
    { table: "reports", column: "status", id: 11, value: "legacy-status", code: "invalid-report-values" },
    { table: "reports", column: "category", id: 11, value: "legacy-category", code: "invalid-report-values" },
    { table: "report_updates", column: "status", id: 100, value: "legacy-status", code: "invalid-report-update-status" },
  ]) {
    it(`preflights incompatible ${table}.${column} and rolls back all 0003 schema/data/ledger changes if Wrangler applies it directly`, async () => {
      await populatedReportUpgrade(async ({ withDb, apply }) => {
        const before = await withDb(async (db) => {
          await db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).bind(value, id).run();
          const report = await preflightMigrations(db, migrations.slice(0, 4));
          assert.equal(report.ok, false);
          const issue = report.issues.find((entry) => entry.code === code);
          assert.ok(issue, JSON.stringify(report));
          assert.equal(issue.rows[0].id, id);
          assert.equal(issue.rows[0][column], value);
          return reportSnapshot(db);
        });
        // Bypass our preflight to prove the SQL transaction itself is safe.
        const result = apply();
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, /CHECK constraint failed/);
        await withDb(async (db) => {
          assert.equal(await db.prepare("PRAGMA foreign_keys").first("foreign_keys"), 1);
          assert.deepEqual(await reportSnapshot(db), before);
          assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
        });
      });
    });
  }

  it("the apply command refuses an untracked database before creating a ledger or changing schema", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "practice-ready-untracked-"));
    try {
      let connection = await openMigrationDatabase({ persistTo: temporary });
      let before;
      try {
        await applyMigrationBatch(connection.db, migrations[0]);
        before = await readSchema(connection.db);
      } finally { await connection.dispose(); }
      const result = cli(["scripts/migrate.mjs", "apply", "--persist-to", temporary]);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /untracked-schema/);
      connection = await openMigrationDatabase({ persistTo: temporary });
      try {
        assert.deepEqual(await readSchema(connection.db), before);
        assert.equal(await connection.db.prepare("SELECT name FROM sqlite_master WHERE name = 'd1_migrations'").first(), null);
      } finally { await connection.dispose(); }
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });

  it("detects partial schema ahead of a ledger and missing tracked schema", async () => {
    await fixture(5, async (db) => {
      await db.prepare("ALTER TABLE bookings ADD COLUMN version integer NOT NULL DEFAULT 1").run();
      await db.prepare("DROP INDEX idx_time_slots_unique").run();
      const report = await preflightMigrations(db, migrations);
      const drift = report.issues.find((issue) => issue.code === "schema-drift");
      assert.ok(drift.rows.some((row) => row.object === "table:bookings" && row.problem === "changed"));
      assert.ok(drift.rows.some((row) => row.object === "index:idx_time_slots_unique" && row.problem === "missing"));
    });
  });

  it("accepts a clean tracked prefix with mapped rooms and finds invalid mappings after 0006", async () => {
    await fixture(6, async (db) => {
      await db.prepare("INSERT INTO locations (id, code, name, type) VALUES (1, 'mpr-test', 'Test', 'room')").run();
      await db.prepare("INSERT INTO rooms (id, name, code, capacity, description) VALUES (1, 'Test', 'mpr-test', 1, 'Test')").run();
      assert.equal((await preflightMigrations(db, migrations)).ok, true);
      await applyMigrationBatch(db, migrations[6], { track: true });
      assert.equal(await db.prepare("SELECT location_id FROM rooms").first("location_id"), 1);
      assert.equal((await preflightMigrations(db, migrations)).ok, true);
      await db.prepare("UPDATE rooms SET location_id = 999").run();
      assert.ok((await preflightMigrations(db, migrations)).issues.some((issue) => issue.code === "unmapped-room-locations"));
    });
  });

  it("refuses generation while snapshots are incomplete", async () => {
    const result = cli(["scripts/block-db-generate.mjs"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /snapshots stop at 0003/);
    // The runtime and package-manager pins are intentionally left in the existing manifest.
    assert.equal(JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")).packageManager, "pnpm@11.25.0");
  });
});
