import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolveRoomId, submitBooking } from "../lib/api-client.ts";

afterEach(() => mock.restoreAll());
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
