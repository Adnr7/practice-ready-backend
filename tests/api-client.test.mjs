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
