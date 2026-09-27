/**
 * Practice Ready API Client
 * Provides resilient data-fetching and mutation methods for the frontend.
 * Always includes offline/demo fallback to guarantee zero UI disruptions.
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
  };
  conflictingSlots?: string[];
  error?: string;
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

export async function fetchEquipmentInventory(
  query = ""
): Promise<any[] | null> {
  try {
    const url = query
      ? `/api/equipment?query=${encodeURIComponent(query)}`
      : "/api/equipment";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { equipment?: any[] };
    return data.equipment ?? null;
  } catch {
    return null;
  }
}

export async function fetchRoomEquipment(
  roomId: number
): Promise<{ ready: any[]; away: any[]; attention: any[] } | null> {
  try {
    const res = await fetch(`/api/equipment/room/${roomId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { groups?: { ready: any[]; away: any[]; attention: any[] } };
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

    const data = (await res.json()) as any;

    if (res.status === 201) {
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
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}
