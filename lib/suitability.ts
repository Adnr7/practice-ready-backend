import { bookingInstant, RoomReadinessError } from "./room-readiness.ts";

const STALE_INSPECTION_MS = 24 * 60 * 60 * 1000;

type Requirement = {
  id: number;
  requirementKey: string;
  label: string;
  equipmentType: string | null;
  equipmentNamePattern: string | null;
  quantity: number;
  isHard: number;
  studentSupplied: number;
};

function profileCode(input: { profile: string; amplified?: boolean; instrument?: string }): string {
  if (input.profile === "vocal") return input.amplified ? "vocal-amplified" : "vocal-acoustic";
  if (input.profile === "band") return "band";
  if (input.profile === "instrument" || input.profile === "individual-instrument") {
    return input.instrument?.toLowerCase() === "keyboard" || !input.instrument ? "instrument-keyboard" : `instrument-${input.instrument.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }
  return input.profile;
}

function addReason(reasons: Array<{ code: string; message: string; requirementKey?: string }>, code: string, message: string, requirementKey?: string) {
  reasons.push({ code, message, ...(requirementKey ? { requirementKey } : {}) });
}

export async function findSuitableRooms(
  db: D1Database,
  input: { profile: string; date: string; startTime: string; endTime: string; partySize: number; amplified?: boolean; instrument?: string; bringOwnInstrument?: boolean },
) {
  const code = profileCode(input);
  const profile = await db.prepare("SELECT id, code, name, category, description FROM practice_profiles WHERE code = ? AND is_active = 1 LIMIT 1").bind(code).first<{ id: number; code: string; name: string; category: string; description: string }>();
  if (!profile) throw new RoomReadinessError("Practice profile is not configured.", 422, "PRACTICE_PROFILE_UNAVAILABLE");
  if (!Number.isSafeInteger(input.partySize) || input.partySize < 1) throw new RoomReadinessError("partySize must be a positive integer.", 400, "PARTY_SIZE_INVALID");
  const requirements = await db.prepare(`
    SELECT id, requirement_key AS requirementKey, label, equipment_type AS equipmentType,
      equipment_name_pattern AS equipmentNamePattern, quantity, is_hard AS isHard, student_supplied AS studentSupplied
    FROM practice_requirements WHERE profile_id = ? ORDER BY id
  `).bind(profile.id).all<Requirement>();
  const rooms = await db.prepare(`
    SELECT r.id, r.name, r.code, r.capacity, r.description, r.readiness_state AS readinessState,
      r.readiness_notes AS readinessNotes, r.location_id AS locationId, l.name AS locationName
    FROM rooms r LEFT JOIN locations l ON l.id = r.location_id
    WHERE r.is_active = 1 ORDER BY r.id
  `).all<{
    id: number; name: string; code: string; capacity: number; description: string; readinessState: string; readinessNotes: string | null; locationId: number | null; locationName: string | null;
  }>();
  const requestedStart = bookingInstant(input.date, input.startTime);
  const requestedEnd = bookingInstant(input.date, input.endTime, true);
  const now = Date.now();
  const result = [];

  for (const room of rooms.results) {
    const reasons: Array<{ code: string; message: string; requirementKey?: string }> = [];
    let hardBlock = false;
    let unverified = room.readinessState === "unknown" || room.locationId === null;
    let partial = room.readinessState === "restricted";
    if (room.readinessState === "closed") {
      hardBlock = true;
      addReason(reasons, "ROOM_CLOSED", "This room is closed for practice.");
    }
    if (room.locationId === null) addReason(reasons, "ROOM_LOCATION_UNVERIFIED", "The room's physical location has not been verified.");
    if (room.capacity < input.partySize) {
      hardBlock = true;
      addReason(reasons, "CAPACITY_TOO_SMALL", `This room supports ${room.capacity} people, but the requested party has ${input.partySize}.`);
    }
    const restriction = await db.prepare("SELECT state, explanation FROM room_restrictions WHERE room_id = ? AND activity_key = ? AND is_active = 1 ORDER BY id DESC LIMIT 1").bind(room.id, code).first<{ state: string; explanation: string }>();
    const practiceType = await db.prepare("SELECT state, explanation FROM room_practice_types WHERE room_id = ? AND profile_id = ? LIMIT 1").bind(room.id, profile.id).first<{ state: string; explanation: string }>();
    if (practiceType?.state === "unsupported") {
      hardBlock = true;
      addReason(reasons, "ROOM_PROFILE_UNSUPPORTED", practiceType.explanation);
    } else if (practiceType?.state === "restricted") {
      partial = true;
      addReason(reasons, "ROOM_PROFILE_RESTRICTED", practiceType.explanation);
    } else if (practiceType?.state === "unknown") {
      unverified = true;
      addReason(reasons, "ROOM_PROFILE_UNVERIFIED", practiceType.explanation);
    }
    if (restriction?.state === "unsupported") {
      hardBlock = true;
      addReason(reasons, "ROOM_RESTRICTED", restriction.explanation);
    } else if (restriction?.state === "restricted") {
      partial = true;
      addReason(reasons, "ROOM_RESTRICTED", restriction.explanation);
    } else if (restriction?.state === "unknown") {
      unverified = true;
      addReason(reasons, "ROOM_RESTRICTION_UNVERIFIED", restriction.explanation);
    }
    const closure = await db.prepare("SELECT reason FROM room_closures WHERE room_id = ? AND is_active = 1 AND starts_at < ? AND ends_at > ? LIMIT 1").bind(room.id, new Date(requestedEnd).toISOString(), new Date(requestedStart).toISOString()).first<{ reason: string }>();
    if (closure) {
      hardBlock = true;
      addReason(reasons, "ROOM_CLOSED", `Closed during the requested time: ${closure.reason}`);
    }
    const bookings = await db.prepare("SELECT date, start_time AS startTime, end_time AS endTime FROM bookings WHERE room_id = ? AND status = 'confirmed'").bind(room.id).all<{ date: string; startTime: string; endTime: string }>();
    if (bookings.results.some((booking) => bookingInstant(booking.date, booking.startTime) < requestedEnd && bookingInstant(booking.date, booking.endTime, true) > requestedStart)) {
      hardBlock = true;
      addReason(reasons, "SLOT_UNAVAILABLE", "The room is already reserved for part of this time.");
    }

    const equipment = room.locationId === null ? [] : (await db.prepare(`
      SELECT e.id, e.equipment_id AS equipmentCode, e.name, e.type, e.condition, e.status,
        e.current_location_id AS currentLocationId, e.last_inspected_at AS lastInspectedAt
      FROM equipment e WHERE e.default_room_id = ? AND e.archived = 0
    `).bind(room.id).all<{
      id: number; equipmentCode: string; name: string; type: string; condition: string; status: string; currentLocationId: number | null; lastInspectedAt: string | null;
    }>()).results;
    const matchedEquipment: Array<{ id: number; equipmentCode: string; name: string; condition: string; status: string }> = [];
    for (const requirement of requirements.results) {
      if (requirement.studentSupplied && input.bringOwnInstrument) continue;
      const candidates = equipment.filter((item) => {
        const typeMatch = !requirement.equipmentType || item.type.toLowerCase() === requirement.equipmentType.toLowerCase();
        const nameMatch = !requirement.equipmentNamePattern || item.name.toLowerCase().includes(requirement.equipmentNamePattern.toLowerCase());
        return typeMatch && nameMatch;
      });
      const present = candidates.filter((item) => item.currentLocationId === room.locationId && item.status === "ready");
      if (present.length < requirement.quantity) {
        const away = candidates.some((item) => item.currentLocationId !== room.locationId);
        const repair = candidates.some((item) => item.status === "service");
        const code = repair ? "REQUIRED_ITEM_IN_REPAIR" : away ? "REQUIRED_ITEM_AWAY" : "REQUIRED_ITEM_MISSING";
        const message = repair ? `${requirement.label} has an open repair.` : away ? `A required ${requirement.label.toLowerCase()} is currently elsewhere.` : `This room does not have enough usable ${requirement.label.toLowerCase()}s.`;
        addReason(reasons, code, message, requirement.requirementKey);
        if (requirement.isHard) partial = true;
      }
      for (const item of present.slice(0, requirement.quantity)) {
        matchedEquipment.push({ id: item.id, equipmentCode: item.equipmentCode, name: item.name, condition: item.condition, status: item.status });
        if (!item.lastInspectedAt || now - Date.parse(item.lastInspectedAt) > STALE_INSPECTION_MS) {
          unverified = true;
          addReason(reasons, "STALE_INSPECTION", `${requirement.label} has not been verified within the operating freshness window.`, requirement.requirementKey);
        }
      }
    }
    if (room.readinessNotes) addReason(reasons, "ROOM_NOTE", room.readinessNotes);
    const suitability = hardBlock ? "unavailable" : unverified ? "unverified" : partial ? "partial" : "match";
    if (suitability === "match") addReason(reasons, "READY", "Room capacity, restrictions, availability, and required equipment are verified.");
    result.push({
      room: { id: room.id, name: room.name, code: room.code, capacity: room.capacity, description: room.description, locationId: room.locationId, locationName: room.locationName, readinessState: room.readinessState },
      suitability,
      reasons,
      matchedEquipment,
      profile: { code: profile.code, name: profile.name, category: profile.category },
    });
  }
  return { profile: { code: profile.code, name: profile.name, category: profile.category, description: profile.description }, criteria: input, rooms: result };
}
