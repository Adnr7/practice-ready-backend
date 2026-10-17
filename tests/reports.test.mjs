import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  createReport,
  generateReportReference,
  getReport,
  listReports,
  updateReport,
} from "../lib/report-store.ts";
import { createReportSchema, updateReportSchema } from "../lib/report-validation.ts";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");

const migrations = [
  "0000_lush_misty_knight.sql",
  "0001_new_the_hood.sql",
  "0002_open_layla_miller.sql",
  "0003_amusing_nekra.sql",
];

let emulator;
let db;

async function applyMigrations() {
  for (const file of migrations) {
    const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").filter((sql) => sql.trim())) {
      await db.prepare(statement).run();
    }
  }
}

async function seedFixtures() {
  await db.batch([
    db.prepare(`INSERT INTO users (id, email, password_hash, salt, full_name, role)
      VALUES (1, 'student-one@example.com', 'hash', 'salt', 'Student One', 'student')`),
    db.prepare(`INSERT INTO users (id, email, password_hash, salt, full_name, role)
      VALUES (2, 'student-two@example.com', 'hash', 'salt', 'Student Two', 'student')`),
    db.prepare(`INSERT INTO users (id, email, password_hash, salt, full_name, role)
      VALUES (3, 'technician@example.com', 'hash', 'salt', 'FTS Technician', 'technician')`),
    db.prepare(`INSERT INTO locations (id, code, name, type)
      VALUES (1, 'mpr-2', 'MPR 2', 'room')`),
    db.prepare(`INSERT INTO rooms (id, name, code, capacity, description)
      VALUES (1, 'MPR 2', 'mpr-2', 6, 'Practice room')`),
    db.prepare(`INSERT INTO equipment
      (id, equipment_id, name, type, current_location_id, default_room_id)
      VALUES (1, 'MIC-01', 'Vocal microphone', 'mic', 1, 1)`),
  ]);
}

before(async () => {
  emulator = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-15",
    d1Databases: ["DB"],
  });
  db = await emulator.getD1Database("DB");
  await applyMigrations();
  await seedFixtures();
});

after(async () => {
  await emulator?.dispose();
});

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM report_updates"),
    db.prepare("DELETE FROM reports"),
  ]);
});

describe("Reports & Support persistence", () => {
  it("creates equipment and assistance reports and scopes lists to the reporter", async () => {
    const equipmentReport = await createReport(db, {
      reference: "RPT-2099-EQUIPMENT",
      reporterId: 1,
      category: "equipment",
      equipmentId: 1,
      locationId: 1,
      issueType: "damaged",
      description: "The microphone grille is loose.",
    });
    const assistanceReport = await createReport(db, {
      reference: "RPT-2099-ASSIST",
      reporterId: 2,
      category: "assistance",
      roomId: 1,
      description: "Please help connect the room mixer before my session.",
    });

    assert.equal(equipmentReport.status, "open");
    assert.equal(equipmentReport.equipmentName, "Vocal microphone");
    assert.equal(equipmentReport.locationName, "MPR 2");
    assert.deepEqual(equipmentReport.updates, []);
    assert.equal(assistanceReport.category, "assistance");

    const ownReports = await listReports(db, 1);
    assert.deepEqual(ownReports.map((report) => report.reference), ["RPT-2099-EQUIPMENT"]);
    assert.deepEqual((await listReports(db, 2)).map((report) => report.reference), ["RPT-2099-ASSIST"]);
  });

  it("persists staff status and message updates in the report history", async () => {
    const report = await createReport(db, {
      reference: "RPT-2099-STATUS",
      reporterId: 1,
      category: "room",
      roomId: 1,
      issueType: "maintenance",
      description: "The left monitor has no output.",
    });

    const acknowledged = await updateReport(db, report.id, 3, {
      status: "acknowledged",
      message: "FTS has accepted this report and is checking the monitor.",
    });
    assert.ok(acknowledged);
    assert.equal(acknowledged.status, "acknowledged");
    assert.equal(acknowledged.updates.length, 1);
    assert.equal(acknowledged.updates[0].authorName, "FTS Technician");
    assert.equal(acknowledged.updates[0].message, "FTS has accepted this report and is checking the monitor.");

    const resolved = await updateReport(db, report.id, 3, {
      status: "resolved",
      message: "The monitor cable was replaced.",
    });
    assert.ok(resolved?.resolvedAt);
    assert.equal(resolved?.updates.length, 2);
    assert.equal((await getReport(db, report.id))?.status, "resolved");
  });
});

describe("Report input validation", () => {
  it("requires context and issue details for room reports", () => {
    const invalid = createReportSchema.safeParse({
      category: "room",
      description: "A problem",
    });
    assert.equal(invalid.success, false);
    if (!invalid.success) {
      assert.ok(invalid.error.flatten().fieldErrors.roomId);
      assert.ok(invalid.error.flatten().fieldErrors.issueType);
    }

    const assistance = createReportSchema.safeParse({
      category: "assistance",
      description: "Please help locate a spare cable.",
    });
    assert.equal(assistance.success, true);
    assert.equal(updateReportSchema.safeParse({}).success, false);
  });

  it("generates references with a stable public prefix", () => {
    assert.match(generateReportReference(new Date("2099-01-02T00:00:00Z")), /^RPT-2099-[A-Z0-9]{10}$/);
  });
});
