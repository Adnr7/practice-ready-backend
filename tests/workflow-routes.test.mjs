import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { applyMigrationBatch, loadMigrations } from "../scripts/migration-tools.mjs";
import { createStoredSession } from "../lib/session-store.ts";

const require = createRequire(import.meta.url);
const dependencies = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = dependencies("miniflare");
const { build } = dependencies("esbuild");

describe("Real journal, attachment, history and policy route boundaries", () => {
  let emulator;
  let db;
  const tokens = {};
  const call = (path, method = "GET", body, user = 1) => emulator.dispatchFetch(`https://example.test${path}`, {
    method, headers: { ...(tokens[user] ? { cookie: `pr_session=${tokens[user]}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  before(async () => {
    const worker = await build({ stdin: { contents: `
      import * as attachments from './app/api/attachments/route.ts';
      import * as attachment from './app/api/attachments/[id]/route.ts';
      import * as journal from './app/api/bookings/[id]/journal/route.ts';
      import * as history from './app/api/bookings/[id]/history/route.ts';
      import * as policy from './app/api/policies/current/route.ts';
      import * as alias from './app/api/policy/current/route.ts';
      import * as staffPolicy from './app/api/staff/policies/route.ts';
      import * as contacts from './app/api/support/contact/route.ts';
      export default { async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/api/attachments') return attachments[request.method](request);
        if (path === '/api/policies/current') return policy.GET(request);
        if (path === '/api/policy/current') return alias.GET(request);
        if (path === '/api/staff/policies') return staffPolicy[request.method](request);
        if (path === '/api/support/contact') return contacts.GET(request);
        const item = /^\\/api\\/attachments\\/([^/]+)$/.exec(path);
        if (item) return attachment.GET(request, { params: Promise.resolve({ id: item[1] }) });
        const booking = /^\\/api\\/bookings\\/([^/]+)\\/(journal|history)$/.exec(path);
        if (booking) return (booking[2] === 'journal' ? journal : history)[request.method](request, { params: Promise.resolve({ id: booking[1] }) });
        return new Response('Not found', { status: 404 });
      } };`, resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" },
      bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", external: ["cloudflare:workers"] });
    emulator = new Miniflare({ modules: true, script: worker.outputFiles[0].text, compatibilityDate: "2026-05-15", d1Databases: ["DB"] });
    db = await emulator.getD1Database("DB");
    for (const migration of await loadMigrations()) await applyMigrationBatch(db, migration);
    await db.batch([
      db.prepare("INSERT INTO users(id,email,password_hash,salt,full_name,role) VALUES (1,'one@example.test','test','test','One','student'),(2,'two@example.test','test','test','Two','student'),(3,'staff@example.test','test','test','Staff','technician'),(4,'admin@example.test','test','test','Admin','admin')"),
      db.prepare("INSERT INTO locations(id,code,name,type) VALUES (1,'room-1','Room 1','room'),(2,'store','Store','storage')"),
      db.prepare("INSERT INTO rooms(id,name,code,capacity,description,location_id) VALUES (1,'Room 1','room-1',4,'Test',1)"),
      db.prepare("INSERT INTO equipment(id,equipment_id,name,type,current_location_id) VALUES (1,'KEY-1','Keyboard','keyboard',1)"),
      db.prepare("INSERT INTO bookings(id,booking_ref,user_id,room_id,date,start_time,end_time,duration_minutes,status) VALUES (1,'R-1',1,1,'2099-01-01','09:00','10:00',60,'completed'),(2,'R-2',2,1,'2099-01-02','09:00','10:00',60,'cancelled')"),
    ]);
    for (const user of [1, 2, 3, 4]) tokens[user] = await createStoredSession(db, user);
  });
  after(async () => emulator?.dispose());

  it("rejects anonymous, foreign-owner, invalid JSON and invalid IDs", async () => {
    assert.equal((await call("/api/bookings/1/journal", "GET", undefined, 0)).status, 401);
    assert.equal((await call("/api/bookings/1/journal", "GET", undefined, 2)).status, 403);
    assert.equal((await call("/api/bookings/1/history", "GET", undefined, 2)).status, 403);
    assert.equal((await call("/api/bookings/nope/journal")).status, 400);
    assert.equal((await call("/api/bookings/1/journal", "PUT", [], 1)).status, 400);
    assert.equal((await call("/api/bookings/1/journal", "PUT", { note: "staff edit" }, 3)).status, 403);
    assert.equal((await call("/api/bookings/2/journal", "PUT", { note: "cancelled" }, 2)).status, 409);
  });

  it("returns image BYTES privately and persists owned journal images across reads", async () => {
    const response = await call("/api/attachments", "POST", { fileName: "practice.png", mediaType: "image/png", dataUrl: "data:image/png;base64,YWJj" });
    assert.equal(response.status, 201);
    const { attachment } = await response.json();
    const image = await call(`/api/attachments/${attachment.id}`);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.match(image.headers.get("cache-control"), /private.*no-store/);
    assert.equal(await image.text(), "abc");
    assert.equal((await call(`/api/attachments/${attachment.id}`, "GET", undefined, 2)).status, 403);
    assert.equal((await call(`/api/attachments/${attachment.id}`, "GET", undefined, 3)).status, 200);
    assert.equal((await call("/api/bookings/1/journal", "PUT", { note: "Saved practice", attachmentIds: [attachment.id] })).status, 200);
    const { journal } = await (await call("/api/bookings/1/journal")).json();
    assert.equal(journal.note, "Saved practice");
    assert.deepEqual(journal.attachmentIds, [attachment.id]);
    const foreign = await call("/api/attachments", "POST", { mediaType: "image/png", dataUrl: "data:image/png;base64,YQ==" }, 2);
    const foreignId = (await foreign.json()).attachment.id;
    assert.equal((await call("/api/bookings/1/journal", "PUT", { note: "Wrong owner", attachmentIds: [foreignId] })).status, 403);
    assert.equal((await call("/api/attachments", "POST", { mediaType: "image/jpeg", dataUrl: "data:image/png;base64,YQ==" })).status, 400);
  });

  it("scopes session history to booking links and lets staff see all linked records", async () => {
    await db.batch([
      db.prepare("INSERT INTO equipment_movements(equipment_id,moved_by_user_id,from_location_id,to_location_id,status,reservation_id) VALUES (1,1,1,2,'returned',1),(1,1,1,2,'returned',NULL),(1,3,1,2,'returned',1)"),
      db.prepare("INSERT INTO reports(reference,reporter_id,category,booking_id,description) VALUES ('REP-1',1,'assistance',1,'Owner report'),('REP-2',3,'assistance',1,'Staff report'),('REP-3',1,'assistance',NULL,'Unlinked report')"),
    ]);
    const owner = await (await call("/api/bookings/1/history")).json();
    assert.equal(owner.movements.length, 1);
    assert.deepEqual(owner.reports.map((report) => report.reference), ["REP-1"]);
    assert.deepEqual(owner.reports[0].attachmentIds, []);
    const staff = await (await call("/api/bookings/1/history", "GET", undefined, 3)).json();
    assert.equal(staff.movements.length, 2);
    assert.equal(staff.reports.length, 2);
  });

  it("publishes policies only as admin, validates canonical slots, and reads identical public aliases", async () => {
    const body = { version: "test-policy-2", equipmentHandling: "Check before use", movementRules: "Designated items only", slotMinutes: 30 };
    assert.equal((await call("/api/staff/policies", "POST", body, 0)).status, 401);
    assert.equal((await call("/api/staff/policies", "POST", body, 1)).status, 403);
    assert.equal((await call("/api/staff/policies", "POST", body, 3)).status, 403);
    assert.equal((await call("/api/staff/policies", "POST", { ...body, slotMinutes: 15 }, 4)).status, 400);
    assert.equal((await call("/api/staff/policies", "POST", body, 4)).status, 201);
    const current = await (await call("/api/policies/current", "GET", undefined, 0)).json();
    assert.equal(current.policy.version, body.version);
    assert.deepEqual(await (await call("/api/policy/current", "GET", undefined, 0)).json(), current);
    assert.equal((await call("/api/staff/policies", "POST", body, 4)).status, 409);
    const contacts = await (await call("/api/support/contact", "GET", undefined, 0)).json();
    assert.ok(Array.isArray(contacts.contacts));
  });

  it("enforces migration foreign keys for optional attachment and reservation links", async () => {
    await assert.rejects(db.prepare("UPDATE equipment SET photo_attachment_id=999999 WHERE id=1").run(), /FOREIGN KEY/);
    await assert.rejects(db.prepare("INSERT INTO equipment_movements(equipment_id,moved_by_user_id,from_location_id,to_location_id,reservation_id) VALUES(1,1,1,2,999999)").run(), /FOREIGN KEY/);
  });
});
