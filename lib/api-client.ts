import type { BookingPhase } from "@/lib/booking-engine";

/**
 * Practice Ready API Client
 * Provides resilient data-fetching and mutation methods for the frontend.
 * Read failures return null; booking failures must never be treated as confirmation.
 */

export interface RoomData {
  id: number;
  name: string;
  code: string;
  capacity: number;
  description: string;
}

export interface SlotData {
  id: number;
  roomId: number;
  date: string;
  period: string;
  startTime: string;
  endTime: string;
  status: "available" | "booked" | "maintenance";
  bookedBy?: string | null;
  passed?: boolean;
}

export interface AvailabilityResponse {
  room: { id: number; name: string };
  date: string;
  periods: Record<string, SlotData[]>;
  slots: SlotData[];
}

export interface BookingPayload {
  roomId: number;
  date: string;
  startTime: string;
  endTime: string;
  guestName?: string;
  guestStudentId?: string;
}

export interface BookingResult {
  success: boolean;
  booking?: {
    id: number;
    bookingRef: string;
    roomId: number;
    roomName?: string;
    date: string;
    startTime: string;
    endTime: string;
    status: string;
    guestStudentName?: string | null;
  };
  conflictingSlots?: string[];
  error?: string;
}

export interface EquipmentItem {
  id: number;
  equipmentId: string;
  name: string;
  type: string;
  modelName?: string | null;
  condition: string;
  status: "ready" | "away" | "attention" | "service" | "missing";
  defaultLocationId?: number | null;
  defaultLocationName?: string | null;
  currentLocationId?: number | null;
  currentLocationName?: string | null;
  defaultRoomId?: number | null;
  lastInspectedAt?: string | null;
  notes?: string | null;
}

export async function fetchRooms(): Promise<RoomData[] | null> {
  try {
    const res = await fetch("/api/rooms", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { rooms?: RoomData[] };
    return data.rooms ?? null;
  } catch {
    return null;
  }
}

export async function resolveRoomId(roomName: string): Promise<number> {
  const rooms = await fetchRooms();
  if (!rooms) throw new Error("Could not load rooms. Please check your connection and try again.");
  const room = rooms.find((item) => item.name === roomName);
  if (!room) throw new Error(`${roomName} is no longer available for booking.`);
  return room.id;
}

export async function fetchAvailability(
  roomId: number,
  date: string
): Promise<AvailabilityResponse | null> {
  try {
    const res = await fetch(`/api/availability?roomId=${roomId}&date=${encodeURIComponent(date)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as AvailabilityResponse;
  } catch {
    return null;
  }
}

export interface ScheduleBooking {
  bookingRef: string;
  startTime: string;
  endTime: string;
  bookedBy: string;
}

export interface ScheduleRoom {
  id: number;
  name: string;
  bookings: ScheduleBooking[];
}

export interface ScheduleResponse {
  date: string;
  rooms: ScheduleRoom[];
}

export async function fetchSchedule(
  date: string
): Promise<ScheduleResponse | null> {
  try {
    const res = await fetch(`/api/schedule?date=${encodeURIComponent(date)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as ScheduleResponse;
  } catch {
    return null;
  }
}

export interface BookingStatus {
  bookingRef: string;
  roomName?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  guestStudentName?: string | null;
  phase: BookingPhase;
}

export async function fetchBookingStatus(
  ref: string
): Promise<BookingStatus | null> {
  try {
    const res = await fetch(
      `/api/bookings/status?ref=${encodeURIComponent(ref)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      booking?: Omit<BookingStatus, "phase">;
      phase?: BookingPhase;
    };
    if (!data.booking || !data.phase) return null;
    return { ...data.booking, phase: data.phase };
  } catch {
    return null;
  }
}

export async function fetchEquipmentInventory(
  query = ""
): Promise<EquipmentItem[] | null> {
  try {
    const url = query
      ? `/api/equipment?query=${encodeURIComponent(query)}`
      : "/api/equipment";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { equipment?: EquipmentItem[] };
    return data.equipment ?? null;
  } catch {
    return null;
  }
}

export async function fetchRoomEquipment(
  roomId: number
): Promise<{
  ready: EquipmentItem[];
  away: EquipmentItem[];
  attention: EquipmentItem[];
} | null> {
  try {
    const res = await fetch(`/api/equipment/room/${roomId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      groups?: {
        ready: EquipmentItem[];
        away: EquipmentItem[];
        attention: EquipmentItem[];
      };
    };
    return data.groups ?? null;
  } catch {
    return null;
  }
}

export async function submitBooking(
  payload: BookingPayload
): Promise<BookingResult> {
  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as {
      booking?: BookingResult["booking"];
      conflictingSlots?: string[];
      error?: string;
    };

    if (res.status === 201 && data.booking?.bookingRef) {
      return { success: true, booking: data.booking };
    }

    if (res.status === 409) {
      return {
        success: false,
        conflictingSlots: data.conflictingSlots ?? [],
        error: data.error,
      };
    }

    return { success: false, error: data.error ?? "Failed to create booking" };
  } catch {
    return {
      success: false,
      error: "Could not confirm the reservation. Check the Room Schedule before retrying; the request may have reached the server.",
    };
  }
}
