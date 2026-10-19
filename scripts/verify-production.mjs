import assert from "node:assert/strict";

const baseUrl = "https://practice-ready-backend.connect-fb5.workers.dev";
const password = `Verify-${crypto.randomUUID()}-a1`;
const email = `omnirush-verify-${Date.now()}@vijaybhoomi.edu.in`;
let cookie = "";
let bookingId;
let bookingVersion;

function setCookie(response) {
  const value = response.headers.get("set-cookie");
  if (value) cookie = value.split(";", 1)[0];
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  setCookie(response);
  let data = null;
  try { data = await response.json(); } catch { /* Binary/empty response. */ }
  return { response, data };
}

function assertStatus(result, expected, label) {
  assert.equal(result.response.status, expected, `${label} returned ${result.response.status}`);
}

function nextInstitutionDate(daysAhead = 1) {
  const now = new Date(Date.now() + 330 * 60 * 1000);
  now.setUTCDate(now.getUTCDate() + daysAhead);
  return now.toISOString().slice(0, 10);
}

function chooseAvailableSlot(slots, excluded = new Set()) {
  return [...slots]
    .filter((slot) => slot.status === "available" && !slot.passed && !excluded.has(slot.startTime))
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0] ?? null;
}

async function authenticate() {
  const registration = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, fullName: "OmniRush Verification", password }),
  });
  assertStatus(registration, 201, "registration");
  assert.ok(registration.data?.user?.id, "registration did not return a user");

  const restored = await request("/api/auth/me");
  assertStatus(restored, 200, "session restoration");
  assert.equal(restored.data?.user?.email, email);

  const profile = await request("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify({ fullName: "OmniRush Verification Updated", phone: "+919876543210" }),
  });
  assertStatus(profile, 200, "profile update");
  assert.equal(profile.data?.user?.fullName, "OmniRush Verification Updated");

  const loggedOut = await request("/api/auth/logout", { method: "POST" });
  assertStatus(loggedOut, 200, "logout");
  const anonymous = await request("/api/auth/me");
  assertStatus(anonymous, 200, "anonymous session check");
  assert.equal(anonymous.data?.user, null);

  const loggedIn = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  assertStatus(loggedIn, 200, "login");
  assert.equal(loggedIn.data?.user?.email, email);
}

async function readCatalog() {
  const rooms = await request("/api/rooms");
  assertStatus(rooms, 200, "rooms");
  assert.ok(rooms.data?.rooms?.length, "rooms were empty");
  const room = rooms.data.rooms[0];
  const date = nextInstitutionDate();
  const availability = await request(`/api/availability?roomId=${room.id}&date=${date}`);
  assertStatus(availability, 200, "availability");
  assert.equal(availability.data?.room?.id, room.id);

  const equipment = await request("/api/equipment");
  assertStatus(equipment, 200, "equipment inventory");
  assert.ok(Array.isArray(equipment.data?.equipment), "equipment response was incomplete");
  const roomEquipment = await request(`/api/equipment/room/${room.id}`);
  assertStatus(roomEquipment, 200, "room equipment");

  for (const path of [
    `/api/schedule?date=${date}`,
    "/api/policies/current",
    "/api/support/contact",
    "/api/locations",
    "/api/practice-profiles",
  ]) {
    const result = await request(path);
    assertStatus(result, 200, path);
  }
  return { room, date, slots: availability.data?.slots ?? [] };
}

async function runBookingWorkflows({ room, date, slots }) {
  const first = chooseAvailableSlot(slots);
  assert.ok(first, "no available slot was returned for the verification booking");
  const create = await request("/api/bookings", {
    method: "POST",
    headers: { "idempotency-key": `verify-${crypto.randomUUID()}` },
    body: JSON.stringify({ roomId: room.id, date, startTime: first.startTime, endTime: first.endTime }),
  });
  assertStatus(create, 201, "booking creation");
  bookingId = create.data?.booking?.id;
  bookingVersion = create.data?.booking?.version;
  assert.ok(bookingId, "booking creation did not return an ID");
  const createdBooking = await request(`/api/bookings/${bookingId}`);
  assertStatus(createdBooking, 200, "booking read-back");
  bookingVersion = createdBooking.data?.booking?.version;

  const reservations = await request("/api/bookings?filter=upcoming");
  assertStatus(reservations, 200, "reservations");
  assert.ok(reservations.data?.bookings?.some((booking) => booking.id === bookingId), "new booking was not listed");

  const attachment = await request("/api/attachments", {
    method: "POST",
    body: JSON.stringify({
      fileName: "verification.png",
      mediaType: "image/png",
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=",
    }),
  });
  assertStatus(attachment, 201, "attachment upload");
  const attachmentId = attachment.data?.attachment?.id;
  assert.ok(attachmentId, "attachment upload did not return an ID");

  const journal = await request(`/api/bookings/${bookingId}/journal`, {
    method: "PUT",
    body: JSON.stringify({ note: "Production verification journal entry", attachmentIds: [attachmentId] }),
  });
  assertStatus(journal, 200, "journal write");
  const journalRead = await request(`/api/bookings/${bookingId}/journal`);
  assertStatus(journalRead, 200, "journal read");
  assert.equal(journalRead.data?.journal?.note, "Production verification journal entry");

  const report = await request("/api/reports", {
    method: "POST",
    body: JSON.stringify({ category: "assistance", bookingId, description: "Production verification assistance request", attachmentIds: [attachmentId] }),
  });
  assertStatus(report, 201, "report/support creation");
  const reports = await request("/api/reports");
  assertStatus(reports, 200, "report/support list");

  const alternatives = new Set([first.startTime]);
  const second = chooseAvailableSlot(slots, alternatives);
  if (second) {
    const rescheduled = await request(`/api/bookings/${bookingId}/reschedule`, {
      method: "PATCH",
      body: JSON.stringify({ roomId: room.id, date, startTime: second.startTime, endTime: second.endTime, version: bookingVersion, reason: "Production verification reschedule" }),
    });
    assertStatus(rescheduled, 200, "booking reschedule");
    bookingVersion = rescheduled.data?.booking?.version;
  }

  const cancelled = await request(`/api/bookings/${bookingId}`, {
    method: "DELETE",
    body: JSON.stringify({ version: bookingVersion }),
  });
  assertStatus(cancelled, 200, "booking cancellation");
  const afterCancellation = await request(`/api/bookings/${bookingId}`);
  assertStatus(afterCancellation, 200, "cancelled booking read-back");
  assert.equal(afterCancellation.data?.booking?.status, "cancelled");
}

async function main() {
  assert.equal(baseUrl, "https://practice-ready-backend.connect-fb5.workers.dev");
  try {
    await authenticate();
    const catalog = await readCatalog();
    await runBookingWorkflows(catalog);
    console.log("Production API workflows passed: registration, session restore, profile update, logout/login, rooms, availability, equipment, journal, attachment, reports/support, booking, reschedule, cancellation, reservations.");
  } finally {
    if (cookie && bookingId) {
      const current = await request(`/api/bookings/${bookingId}`);
      const status = current.data?.booking?.status;
      const version = current.data?.booking?.version ?? bookingVersion;
      if (current.response.ok && status === "confirmed") {
        await request(`/api/bookings/${bookingId}`, { method: "DELETE", body: JSON.stringify({ version }) });
      }
    }
    if (cookie) await request("/api/auth/logout", { method: "POST" });
  }
  console.log("Verification cleanup: booking cancelled; disposable verification account remains because no supported account-delete workflow exists.");
}

main().catch((error) => {
  console.error(`Production verification failed: ${error.message}`);
  process.exitCode = 1;
});
