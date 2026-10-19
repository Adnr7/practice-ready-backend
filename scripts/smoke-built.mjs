// Rehearse the production build with an isolated local DB and disposable secrets.
// Never reads .dev.vars, logs credentials, or uses the developer's D1 state.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { applyMigrationBatch, loadMigrations, openMigrationDatabase, projectRoot } from "./migration-tools.mjs";

const temp = await mkdtemp(path.join(os.tmpdir(), "practice-ready-built-smoke-"));
let worker;
let workerClosed;
let logs = "";
let disposableSecrets = [];
try {
  const builtRoot = path.join(projectRoot, "dist/server");
  const built = JSON.parse(await readFile(path.join(builtRoot, "wrangler.json"), "utf8"));
  assert.ok(built.d1_databases?.some((database) => database.binding === "DB"), "Built Worker must bind D1");
  const persistTo = path.join(temp, "state");
  const databaseId = "isolated-built-smoke";
  const connection = await openMigrationDatabase({ persistTo, databaseId });
   try {
     for (const migration of await loadMigrations()) await applyMigrationBatch(connection.db, migration);
     // The built-worker smoke is a persistence/replay check and must be
     // deterministic at any wall-clock time. The Asmi 06:00 release boundary
     // is covered separately by tests/asmi-contract.test.mjs.
     await connection.db.prepare("UPDATE booking_policies SET student_window = 0, advance_days = 14 WHERE is_current = 1").run();
   }
  finally { await connection.dispose(); }
  const secrets = { AUTH_SECRET: crypto.randomUUID(), SEED_TOKEN: crypto.randomUUID(), ADMIN_PASSWORD: crypto.randomUUID() };
  disposableSecrets = Object.values(secrets);
  const config = path.join(temp, "wrangler.json");
  await writeFile(config, JSON.stringify({ name: "practice-ready-smoke", main: path.resolve(builtRoot, built.main),
    compatibility_date: built.compatibility_date, compatibility_flags: built.compatibility_flags,
    no_bundle: true, rules: built.rules, assets: { directory: path.resolve(builtRoot, built.assets.directory) },
    d1_databases: [{ binding: "DB", database_name: databaseId, database_id: databaseId }], vars: secrets }));
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  worker = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--config", config,
    "--local", "--persist-to", persistTo, "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0"],
  { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" } });
  for (const stream of [worker.stdout, worker.stderr]) stream.on("data", (chunk) => { logs = (logs + chunk.toString()).slice(-16000); });
  workerClosed = new Promise((resolve) => worker.once("close", resolve));
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (worker.exitCode !== null) throw new Error("Built Worker exited before readiness (logs withheld to protect disposable credentials).");
    try { ready = (await fetch(`${base}/api/policies/current`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Starting. */ }
    if (ready) break;
    await sleep(250);
  }
  assert.ok(ready, "Built Worker did not become ready");
  const request = async (url, method = "GET", body, cookie, extraHeaders = {}) => fetch(`${base}${url}`, {
    method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { cookie } : {}), ...extraHeaders },
    // Illustrative seeding inserts thousands of rows; it is setup, not an API latency benchmark.
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(url === "/api/seed" ? 60000 : 60000),
  });
  const seed = await request("/api/seed", "POST", undefined, undefined, { authorization: `Bearer ${secrets.SEED_TOKEN}` });
  assert.equal(seed.status, 200, "Local illustrative seed");
  const home = await request("/");
  if (home.status !== 200) logs += `\nHome response: ${(await home.text()).slice(0, 4000)}\n`;
  assert.equal(home.status, 200, "Home SSR");
  const registration = await request("/api/auth/register", "POST", { email: "smoke@example.invalid", fullName: "Smoke Student", password: crypto.randomUUID() });
  assert.equal(registration.status, 201);
  const cookie = registration.headers.get("set-cookie").split(";")[0];
  assert.ok((await (await request("/api/auth/me", "GET", undefined, cookie)).json()).user);
  const rooms = (await (await request("/api/rooms")).json()).rooms;
  assert.ok(rooms.length);
   const shiftedNow = new Date(Date.now() + 330 * 60_000);
   const tomorrow = new Date(shiftedNow);
   tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
   const date = tomorrow.toISOString().slice(0, 10);
   const startTime = "09:00";
   const endTime = "10:00";
   const payload = { roomId: rooms[0].id, date, startTime, endTime };
  const key = `smoke-${crypto.randomUUID()}`;
  const created = await request("/api/bookings", "POST", payload, cookie, { "Idempotency-Key": key });
  assert.equal(created.status, 201, "Create authenticated reservation");
  const creation = await created.json();
  const replay = await request("/api/bookings", "POST", payload, cookie, { "Idempotency-Key": key });
  assert.equal(replay.headers.get("Idempotent-Replay"), "true");
  assert.deepEqual(await replay.json(), creation);
  const id = creation.booking.id;
  const imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=";
  const upload = await request("/api/attachments", "POST", { fileName: "practice.png", mediaType: "image/png", dataUrl: imageData }, cookie);
  assert.equal(upload.status, 201);
  const attachmentId = (await upload.json()).attachment.id;
  const image = await request(`/api/attachments/${attachmentId}`, "GET", undefined, cookie);
  assert.equal(image.status, 200); assert.equal((await image.arrayBuffer()).byteLength, 68);
  assert.equal((await request(`/api/bookings/${id}/journal`, "PUT", { note: "Persistent smoke note", attachmentIds: [attachmentId] }, cookie)).status, 200);
  assert.equal((await (await request(`/api/bookings/${id}/journal`, "GET", undefined, cookie)).json()).journal.note, "Persistent smoke note");
  const report = await request("/api/reports", "POST", { category: "assistance", bookingId: id, description: "Smoke assistance request", attachmentIds: [attachmentId] }, cookie);
  assert.equal(report.status, 201);
  const history = await (await request(`/api/bookings/${id}/history`, "GET", undefined, cookie)).json();
  assert.equal(history.reports.length, 1);
  assert.equal((await request("/api/staff/operations", "GET", undefined, cookie)).status, 403);
  const adminLogin = await request("/api/auth/login", "POST", { email: "admin@tsm.edu.in", password: secrets.ADMIN_PASSWORD });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get("set-cookie").split(";")[0];
  assert.equal((await request("/api/staff/operations", "GET", undefined, adminCookie)).status, 200);
  assert.equal((await request("/api/auth/logout", "POST", undefined, cookie)).status, 200);
  assert.equal((await (await request("/api/auth/me", "GET", undefined, cookie)).json()).user, null);
  console.log("Built Worker smoke passed: SSR, isolated seed, DB sessions/revocation, booking replay, image bytes, journal, report/history, staff role boundary.");
} catch (error) {
  for (const secret of disposableSecrets) logs = logs.replaceAll(secret, "[REDACTED]");
  console.error(logs);
  throw error;
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await Promise.race([workerClosed, sleep(5000)]);
    if (worker.exitCode === null) { worker.kill("SIGKILL"); await workerClosed; }
  }
  await rm(temp, { recursive: true, force: true });
}
