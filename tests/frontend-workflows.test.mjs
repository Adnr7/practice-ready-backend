import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createAttachment, getAttachment, getJournal, saveJournal } from "../lib/frontend-workflows.ts";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const migrations = [
  "0000_lush_misty_knight.sql", "0001_new_the_hood.sql", "0002_open_layla_miller.sql",
  "0003_amusing_nekra.sql", "0004_equipment_movements.sql", "0005_reservation_lifecycle.sql",
  "0006_room_readiness.sql", "0007_frontend_workflows.sql",
];

async function applyMigrations(db) {
  for (const file of migrations) {
    const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").filter((part) => part.trim())) await db.prepare(statement).run();
  }
}

describe("Persistent original-frontend workflow support", () => {
  let emulator;
  let db;
  before(async () => {
    emulator = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-05-15", d1Databases: ["DB"] });
    db = await emulator.getD1Database("DB");
    await applyMigrations(db);
    await db.batch([
      db.prepare("INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES (1, 'student@example.com', 'hash', 'salt', 'Student', 'student')"),
      db.prepare("INSERT INTO locations (id, code, name, type) VALUES (1, 'mpr-2', 'MPR 2', 'room')"),
      db.prepare("INSERT INTO rooms (id, name, code, capacity, description) VALUES (1, 'MPR 2', 'mpr-2', 6, 'Room')"),
      db.prepare("INSERT INTO bookings (id, booking_ref, user_id, room_id, date, start_time, end_time, duration_minutes, status) VALUES (1, 'PR-2099-9011', 1, 1, '2099-01-01', '09:00', '10:00', 60, 'completed')"),
    ]);
  });
  after(async () => emulator?.dispose());

  it("stores an owned attachment and a one-per-booking journal entry", async () => {
    const actor = { userId: 1, role: "student" };
    const attachment = await createAttachment(db, actor, { fileName: "practice.png", mediaType: "image/png", dataUrl: "data:image/png;base64,AAAA" });
    assert.ok(attachment.id);
    const journal = await saveJournal(db, 1, actor, { note: "Worked on the chorus.", attachmentIds: [attachment.id] });
    assert.deepEqual(journal.attachmentIds, [attachment.id]);
    assert.equal((await getJournal(db, 1, actor)).note, "Worked on the chorus.");
    assert.equal((await getAttachment(db, attachment.id, actor)).fileName, "practice.png");
    await assert.rejects(saveJournal(db, 1, { userId: 2, role: "student" }, { note: "Not mine" }), (error) => error.code === "BOOKING_NOT_FOUND" || error.code === "BOOKING_FORBIDDEN");
  });
});
