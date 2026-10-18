import { getDb } from "@/db";
import { getInstitutionNow, isValidCalendarDate, validateBookingRequest } from "@/lib/booking-engine";
import { getCurrentBookingPolicy } from "@/lib/booking-policy";
import { roomReadinessErrorResponse } from "@/lib/room-readiness";
import { hasRoomReadinessSchema, schemaMigrationResponse } from "@/lib/schema-capabilities";
import { findSuitableRooms } from "@/lib/suitability";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const profile = params.get("profile")?.trim() ?? "";
    const date = params.get("date")?.trim() ?? "";
    const endDate = params.get("endDate")?.trim() || undefined;
    const startTime = params.get("startTime")?.trim() ?? "";
    const endTime = params.get("endTime")?.trim() ?? "";
    const partySize = Number(params.get("partySize") ?? "1");
    if (!profile || !date || !startTime || !endTime || !isValidCalendarDate(date)) {
      return Response.json({ error: "profile, date, startTime, endTime, and a valid date are required." }, { status: 400 });
    }
    const db = getDb().$client;
    if (!(await hasRoomReadinessSchema(db))) {
      return schemaMigrationResponse("Room readiness migration is required before suitability can be evaluated.", { migration: "0006_room_readiness.sql" });
    }
    const policy = await getCurrentBookingPolicy(db);
    const validation = validateBookingRequest({ date, endDate, startTime, endTime }, getInstitutionNow(), policy);
    if (!validation.valid) {
      return Response.json({ error: validation.error ?? "Invalid suitability time window.", code: "SUITABILITY_WINDOW_INVALID" }, { status: 400 });
    }
    const result = await findSuitableRooms(db, {
      profile,
      date,
      endDate,
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
