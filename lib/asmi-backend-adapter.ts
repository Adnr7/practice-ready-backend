import {
  fetchEquipmentInventory,
  fetchLocations,
  fetchReservations,
  fetchRooms,
  type EquipmentItem,
  type ReservationData,
} from "@/lib/api-client";
import type { Reservation } from "@/components/reservations";

export const RESERVATIONS_STORAGE_KEY = "practice-ready-reservations-v1";
export const EQUIPMENT_STORAGE_KEY = "practice-ready-backend-equipment-v1";
export const LOCATIONS_STORAGE_KEY = "practice-ready-backend-locations-v1";

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function dispatchRefresh(name: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}

function clockLabel(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function parseClock(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function localDateTime(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

function formatTimeRange(startTime: string, endTime: string) {
  const start = clockLabel(startTime);
  const end = clockLabel(endTime);
  return start.slice(-2) === end.slice(-2)
    ? `${start.slice(0, -3)}–${end}`
    : `${start}–${end}`;
}

function rangeSlots(date: string, startTime: string, endDate: string, endTime: string) {
  const slots: string[] = [];
  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${endDate}T${endTime}:00`);
  for (let cursor = start.getTime(); cursor < end.getTime(); cursor += 30 * 60 * 1000) {
    const current = new Date(cursor);
    slots.push(`${String(current.getHours()).padStart(2, "0")}:${String(current.getMinutes()).padStart(2, "0")}`);
  }
  return slots;
}

export function reservationFromApi(value: ReservationData): Reservation {
  const endDate = value.endDate ?? value.date;
  const start = localDateTime(value.date, value.startTime);
  const end = localDateTime(endDate, value.endTime);
  return {
    id: value.bookingRef,
    backendId: value.id,
    version: value.version,
    roomId: value.roomId,
    room: value.roomName ?? `Room ${value.roomId}`,
    operationalDate: value.date,
    slots: rangeSlots(value.date, value.startTime, endDate, value.endTime),
    time: formatTimeRange(value.startTime, value.endTime),
    start,
    end,
    cancelled: value.status === "cancelled",
    createdAt: value.createdAt,
    endedEarly: value.sessionEndedAt
      ? {
          at: value.sessionEndedAt,
          originalEnd: end,
          originalTime: formatTimeRange(value.startTime, value.endTime),
          originalSlots: rangeSlots(value.date, value.startTime, endDate, value.endTime),
          blockedUntil: value.sessionEndedAt,
        }
      : undefined,
    cancelledAt: value.cancelledAt ?? undefined,
    cancelReason: value.cancellationReason ?? undefined,
  };
}

export function cacheReservations(items: Reservation[]) {
  const storage = browserStorage();
  if (!storage) return;
  storage.setItem(RESERVATIONS_STORAGE_KEY, JSON.stringify(items));
  dispatchRefresh("practice-ready-backend-reservations");
}

export async function refreshBackendReservations() {
  const values = await fetchReservations("all");
  if (!values) return null;
  const items = values.map(reservationFromApi);
  cacheReservations(items);
  return items;
}

export function timeToMinutes(value: string) {
  return parseClock(value);
}

export function equipmentFromApi(value: EquipmentItem) {
  const defaultLocation = value.defaultLocationName ?? value.currentLocationName ?? "Unknown";
  return {
    id: value.equipmentId,
    displayId: value.equipmentId,
    name: value.name,
    modelName: value.modelName ?? undefined,
    currentLocation: value.currentLocationName ?? defaultLocation,
    defaultLocation,
    condition: value.condition,
    status: value.status,
  } as const;
}

export async function refreshBackendCatalog() {
  const [equipment, locations, rooms] = await Promise.all([
    fetchEquipmentInventory(),
    fetchLocations(),
    fetchRooms(),
  ]);
  const storage = browserStorage();
  if (storage && equipment) {
    storage.setItem(EQUIPMENT_STORAGE_KEY, JSON.stringify(equipment.map(equipmentFromApi)));
  }
  if (storage && locations?.success) {
    storage.setItem(LOCATIONS_STORAGE_KEY, JSON.stringify(locations.data.locations.map((item) => item.name)));
  }
  dispatchRefresh("practice-ready-backend-catalog");
  return {
    equipment: equipment?.map(equipmentFromApi) ?? null,
    locations: locations?.success ? locations.data.locations.map((item) => item.name) : null,
    rooms,
  };
}

export function readCachedEquipment<T>() {
  try {
    const value = JSON.parse(browserStorage()?.getItem(EQUIPMENT_STORAGE_KEY) ?? "null");
    return Array.isArray(value) ? value as T[] : null;
  } catch {
    return null;
  }
}

export function readCachedLocations() {
  try {
    const value = JSON.parse(browserStorage()?.getItem(LOCATIONS_STORAGE_KEY) ?? "null");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
  } catch {
    return null;
  }
}
