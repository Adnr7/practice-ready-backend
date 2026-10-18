import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  fetchCurrentUser,
  fetchEquipmentInventory,
  fetchRoomEquipment,
  login,
  logout,
  register,
  resolveRoomId,
  submitBooking,
  attachmentUrl,
  cancelReservation,
  createEquipmentMovement,
  createReport,
  endReservationSession,
  fetchBookingHistory,
  fetchBookingJournal,
  fetchLocations,
  fetchPracticeProfiles,
  fetchPublishedPolicy,
  fetchRoomSuitability,
  fetchSupportContacts,
  returnEquipmentMovement,
  saveBookingJournal,
  submitSessionEquipmentUsage,
  updateReport,
  uploadAttachment,
} from "../lib/api-client.ts";

afterEach(() => mock.restoreAll());

describe("Authentication API client", () => {
  const user = {
    id: 7,
    email: "student@example.com",
    fullName: "Practice Student",
    studentId: "TSM-2026-0007",
    role: "student",
    createdAt: "2026-10-17 10:00:00",
  };

  it("reads the current cookie-backed session and includes credentials", async () => {
    const fetch = mock.method(globalThis, "fetch", async () =>
      Response.json({ user }),
    );

    assert.deepEqual(await fetchCurrentUser(), user);
    assert.equal(fetch.mock.calls[0].arguments[0], "/api/auth/me");
    assert.equal(fetch.mock.calls[0].arguments[1].credentials, "include");
  });

  it("returns typed login and registration results without treating errors as sessions", async () => {
    const fetch = mock.method(globalThis, "fetch", async (input, init) => {
      assert.equal(init.credentials, "include");
      if (input === "/api/auth/login") return Response.json({ user });
      return Response.json({ error: "An account with this email already exists." }, { status: 400 });
    });

    assert.deepEqual(
      await login({ email: "student@example.com", password: "secret123" }),
      { success: true, user },
    );
    assert.deepEqual(
      await register({
        email: "student@example.com",
        password: "secret123",
        fullName: "Practice Student",
      }),
      {
        success: false,
        user: null,
        error: "An account with this email already exists.",
      },
    );
    assert.equal(fetch.mock.calls.length, 2);
  });

  it("logs out through the session endpoint and reports transport failures", async () => {
    const fetch = mock.method(globalThis, "fetch", async () => Response.json({ success: true }));
    assert.deepEqual(await logout(), { success: true });
    assert.equal(fetch.mock.calls[0].arguments[0], "/api/auth/logout");
    assert.equal(fetch.mock.calls[0].arguments[1].method, "POST");

    fetch.mock.mockImplementation(async () => { throw new Error("offline"); });
    assert.deepEqual(await logout(), {
      success: false,
      error: "Could not reach the authentication service.",
    });
  });
});

describe("Live workflow client contracts", () => {
  it("uploads images, saves a journal, and reloads its note and attachment IDs", async () => {
    let journal = null;
    const fetch = mock.method(globalThis, "fetch", async (url, init) => {
      assert.equal(init.credentials, "include");
      if (url === "/api/attachments") {
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), { fileName: "practice.png", mediaType: "image/png", dataUrl: "data:image/png;base64,YQ==" });
        return Response.json({ attachment: { id: 19, fileName: "practice.png" } }, { status: 201 });
      }
      assert.equal(url, "/api/bookings/42/journal");
      if (init.method === "PUT") journal = { id: 3, bookingId: 42, ...JSON.parse(init.body) };
      return Response.json({ journal });
    });
    assert.deepEqual(await fetchBookingJournal(42), { success: true, data: { journal: null } });
    const uploaded = await uploadAttachment({ fileName: "practice.png", mediaType: "image/png", dataUrl: "data:image/png;base64,YQ==" });
    assert.equal(uploaded.data.attachment.id, 19);
    assert.equal(attachmentUrl(19), "/api/attachments/19");
    const saved = await saveBookingJournal(42, { note: "Rehearsed scales", attachmentIds: [19] });
    assert.equal(saved.success, true);
    assert.deepEqual(await fetchBookingJournal(42), saved);
    assert.equal(fetch.mock.calls[3].arguments[1].cache, "no-store");
  });

  it("reads the composite history contract including report images", async () => {
    const history = { history: [{ id: 1, action: "rescheduled" }], usage: [{ id: 2, equipmentLabel: "Piano" }], movements: [{ id: 3, status: "returned" }], reports: [{ id: 4, reference: "R-4", attachmentIds: [19] }] };
    const fetch = mock.method(globalThis, "fetch", async () => Response.json(history));
    assert.deepEqual(await fetchBookingHistory(42), { success: true, data: history });
    assert.equal(fetch.mock.calls[0].arguments[0], "/api/bookings/42/history");
  });

  it("distinguishes unpublished policy and empty contacts from load failures", async () => {
    const fetch = mock.method(globalThis, "fetch", async (url) => Response.json(url === "/api/policies/current" ? { policy: null } : { contacts: [] }));
    assert.deepEqual(await fetchPublishedPolicy(), { success: true, data: { policy: null } });
    assert.deepEqual(await fetchSupportContacts(), { success: true, data: { contacts: [] } });
    fetch.mock.mockImplementation(async () => Response.json({ error: "Database unavailable" }, { status: 503 }));
    assert.deepEqual(await fetchPublishedPolicy(), { success: false, error: "Database unavailable" });
    assert.deepEqual(await fetchSupportContacts(), { success: false, error: "Database unavailable" });
  });

  it("loads configured profiles and serializes the actual suitability criteria", async () => {
    const criteria = { profile: "instrument-bass guitar", date: "2099-01-01", startTime: "09:00", endTime: "10:00", partySize: 3, bringOwnInstrument: true, amplified: false };
    const profiles = { profiles: [{ id: 9, code: criteria.profile, name: "Bass" }], requirements: [] };
    const result = { profile: profiles.profiles[0], criteria, rooms: [{ room: { id: 7, name: "Room seven" }, suitability: "unverified", reasons: [{ code: "STALE_INSPECTION", message: "Not verified recently" }], matchedEquipment: [] }] };
    const fetch = mock.method(globalThis, "fetch", async (url) => Response.json(url === "/api/practice-profiles" ? profiles : result));
    assert.deepEqual(await fetchPracticeProfiles(), { success: true, data: profiles });
    assert.deepEqual(await fetchRoomSuitability(criteria), { success: true, data: result });
    const url = new URL(fetch.mock.calls[1].arguments[0], "https://practice.test");
    for (const [key, value] of Object.entries(criteria)) assert.equal(url.searchParams.get(key), String(value));
    assert.equal(url.pathname, "/api/rooms/suitability");
  });

  it("rejects missing envelopes, invalid JSON, forbidden access and offline reads", async () => {
    const reads = [() => fetchBookingJournal(2), () => fetchBookingHistory(2), fetchPublishedPolicy, fetchSupportContacts, fetchPracticeProfiles, fetchLocations, () => fetchRoomSuitability({ profile: "band", date: "2099-01-01", startTime: "09:00", endTime: "10:00", partySize: 2 })];
    const fetch = mock.method(globalThis, "fetch", async () => Response.json({}));
    for (const read of reads) assert.equal((await read()).success, false);
    fetch.mock.mockImplementation(async () => new Response("not JSON"));
    for (const read of reads) assert.equal((await read()).success, false);
    fetch.mock.mockImplementation(async () => Response.json({ error: "Forbidden" }, { status: 403 }));
    for (const read of reads) assert.deepEqual(await read(), { success: false, error: "Forbidden" });
    fetch.mock.mockImplementation(async () => { throw new Error("offline"); });
    for (const read of reads) assert.equal((await read()).success, false);
  });

  it("keeps caller-owned report retry keys and attached images on repeated requests", async () => {
    const payload = { category: "assistance", description: "Please check the setup", bookingId: 42, attachmentIds: [19, 20] };
    const fetch = mock.method(globalThis, "fetch", async () => Response.json({ error: "Try again" }, { status: 503 }));
    assert.equal((await createReport(payload, "stable-report-draft")).success, false);
    fetch.mock.mockImplementation(async () => Response.json({ report: { id: 8, reference: "R-8", ...payload } }, { status: 201 }));
    assert.equal((await createReport(payload, "stable-report-draft")).success, true);
    for (const call of fetch.mock.calls) {
      assert.equal(call.arguments[1].headers["Idempotency-Key"], "stable-report-draft");
      assert.deepEqual(JSON.parse(call.arguments[1].body), payload);
    }
  });

  it("does not claim mutation success for empty or error responses", async () => {
    const operations = [() => createReport({ category: "assistance", description: "Help" }), () => saveBookingJournal(2, { note: "Practice", attachmentIds: [] }), () => uploadAttachment({ fileName: "a.png", mediaType: "image/png", dataUrl: "data:image/png;base64,YQ==" }), () => cancelReservation(2, 1), () => endReservationSession(2, 1), () => submitSessionEquipmentUsage(2, [1]), () => updateReport(3, { status: "resolved" }), () => createEquipmentMovement({ equipmentId: 1, toLocationId: 2 }), () => returnEquipmentMovement(3)];
    const fetch = mock.method(globalThis, "fetch", async () => Response.json({}));
    for (const operation of operations) assert.equal((await operation()).success, false);
    fetch.mock.mockImplementation(async () => Response.json({ error: "Denied" }, { status: 403 }));
    for (const operation of operations) assert.equal((await operation()).success, false);
  });

  it("rejects unsupported and oversized image uploads before sending", async () => {
    const fetch = mock.method(globalThis, "fetch", async () => { throw new Error("must not upload"); });
    assert.equal((await uploadAttachment({ fileName: "a.svg", mediaType: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,YQ==" })).success, false);
    assert.equal((await uploadAttachment({ fileName: "a.png", mediaType: "image/png", dataUrl: "x".repeat(500_001) })).success, false);
    assert.equal(fetch.mock.calls.length, 0);
  });
});

describe("Equipment API client", () => {
  it("loads the directory and room groups from their live endpoints", async () => {
    const fetch = mock.method(globalThis, "fetch", async (input) => {
      if (input === "/api/equipment?query=microphone%20stand") {
        return Response.json({
          equipment: [{ id: 12, equipmentId: "MS-01", name: "Mic stand", type: "stand", status: "ready", condition: "Fully functional" }],
        });
      }
      return Response.json({
        groups: {
          ready: [{ id: 12, equipmentId: "MS-01", name: "Mic stand", type: "stand", status: "ready", condition: "Fully functional" }],
          away: [],
          attention: [],
        },
      });
    });

    const directory = await fetchEquipmentInventory("microphone stand");
    const room = await fetchRoomEquipment(3);

    assert.equal(directory?.[0].equipmentId, "MS-01");
    assert.equal(room?.ready[0].equipmentId, "MS-01");
    assert.equal(fetch.mock.calls[0].arguments[1].credentials, "include");
    assert.equal(fetch.mock.calls[1].arguments[0], "/api/equipment/room/3");
  });
});

describe("Booking API client", () => {
  it("reuses a caller-owned booking key across a lost-response retry", async () => {
    const calls = [];
    mock.method(globalThis, "fetch", async (_url, init) => {
      calls.push(init.headers["Idempotency-Key"]);
      if (calls.length === 1) throw new Error("Lost response");
      return Response.json({ booking: { bookingRef: "PR-2099-1234" } }, { status: 201 });
    });
    const payload = { roomId: 1, date: "2099-01-01", startTime: "09:00", endTime: "10:00" };
    assert.equal((await submitBooking(payload, "booking-stable-retry")).success, false);
    assert.equal((await submitBooking(payload, "booking-stable-retry")).success, true);
    assert.deepEqual(calls, ["booking-stable-retry", "booking-stable-retry"]);
  });
  it("resolves the database room ID instead of using the room number", async () => {
    mock.method(globalThis, "fetch", async () => Response.json({ rooms: [
      { id: 1, name: "MPR 2", code: "mpr-2" },
      { id: 2, name: "MPR 3", code: "mpr-3" },
    ] }));
    assert.equal(await resolveRoomId("MPR 3"), 2);
    await assert.rejects(resolveRoomId("MPR 5"));
  });

  it("does not report success for failed or malformed booking responses", async () => {
    const payload = { roomId: 1, date: "2099-01-01", startTime: "09:00", endTime: "09:30" };
    const fetch = mock.method(globalThis, "fetch", async () => Response.json({ error: "Unavailable" }, { status: 500 }));
    assert.equal((await submitBooking(payload)).success, false);
    fetch.mock.mockImplementation(async () => Response.json({}, { status: 201 }));
    assert.equal((await submitBooking(payload)).success, false);
    fetch.mock.mockImplementation(async () => { throw new Error("Connection lost"); });
    assert.equal((await submitBooking(payload)).success, false);
    fetch.mock.mockImplementation(async () => Response.json({ booking: { bookingRef: "PR-2099-1001" } }, { status: 201 }));
    assert.equal((await submitBooking(payload)).success, true);
  });
});
