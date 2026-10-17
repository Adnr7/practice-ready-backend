import { getDb } from "@/db";
import { isValidCalendarDate } from "@/lib/booking-engine";
import { roomReadinessErrorResponse } from "@/lib/room-readiness";
import { findSuitableRooms } from "@/lib/suitability";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const profile = params.get("profile")?.trim() ?? "";
    const date = params.get("date")?.trim() ?? "";
    const startTime = params.get("startTime")?.trim() ?? "";
    const endTime = params.get("endTime")?.trim() ?? "";
    const partySize = Number(params.get("partySize") ?? "1");
    if (!profile || !date || !startTime || !endTime || !isValidCalendarDate(date)) {
      return Response.json({ error: "profile, date, startTime, endTime, and a valid date are required." }, { status: 400 });
    }
    const result = await findSuitableRooms(getDb().$client, {
      profile,
      date,
      startTime,
      endTime,
      partySize,
      amplified: params.get("amplified") === "true",
      instrument: params.get("instrument") ?? undefined,
      bringOwnInstrument: params.get("bringOwnInstrument") === "true",
    });
    return Response.json(result);
  } catch (error) {
    return roomReadinessErrorResponse(error);
  }
}
