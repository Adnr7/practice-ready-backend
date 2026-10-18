import type { BookingPhase } from "@/lib/booking-engine";

/**
 * Practice Ready API Client
 * Provides resilient data-fetching and mutation methods for the frontend.
 * Read failures return null; booking failures must never be treated as confirmation.
 */

export type UserRole = "student" | "technician" | "admin";

export interface UserProfile {
  id: number;
  email: string;
  fullName: string;
  studentId: string | null;
  phone?: string | null;
  role: UserRole;
  isActive?: boolean;
  createdAt: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload extends LoginPayload {
  fullName: string;
  studentId?: string;
}

export interface AuthResult {
  success: boolean;
  user: UserProfile | null;
  error?: string;
}

export interface LogoutResult {
  success: boolean;
  error?: string;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const data = await readJson<{ error?: string }>(response);
  return data?.error ?? fallback;
}

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
  endDate?: string;
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
    endDate?: string;
    startTime: string;
    endTime: string;
    status: string;
    guestStudentName?: string | null;
  };
  conflictingSlots?: string[];
  error?: string;
}

export interface ReservationData {
  id: number;
  bookingRef: string;
  userId: number | null;
  guestStudentName?: string | null;
  guestStudentId?: string | null;
  roomId: number;
  roomName?: string;
  date: string;
  endDate?: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  policyVersion?: string | null;
  status: "confirmed" | "cancelled" | "completed";
  phase: BookingPhase;
  version: number;
  sessionEndedAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
}

export interface EquipmentUsageData {
  id: number;
  bookingId: number;
  equipmentId: number;
  actorUserId: number;
  equipmentLabel: string;
  equipmentCode: string;
  observedLocationId: number | null;
  observedLocationName: string | null;
  observedCondition: string;
  observedStatus: string;
  observedAt: string;
  createdAt: string;
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

/** The current session, or null when the browser is anonymous. */
export async function me(): Promise<UserProfile | null> {
  try {
    const res = await fetch("/api/auth/me", {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await readJson<{ user?: UserProfile | null }>(res);
    return data?.user ?? null;
  } catch {
    return null;
  }
}

export const fetchCurrentUser = me;

async function authenticate(
  path: "/api/auth/login" | "/api/auth/register",
  payload: LoginPayload | RegisterPayload,
): Promise<AuthResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return {
        success: false,
        user: null,
        error: await responseError(res, "Authentication failed."),
      };
    }

    const data = await readJson<{ user?: UserProfile | null }>(res);
    if (!data?.user) {
      return { success: false, user: null, error: "Authentication response was incomplete." };
    }
    return { success: true, user: data.user };
  } catch {
    return {
      success: false,
      user: null,
      error: "Could not reach the authentication service.",
    };
  }
}

export function login(payload: LoginPayload): Promise<AuthResult> {
  return authenticate("/api/auth/login", payload);
}

export function register(payload: RegisterPayload): Promise<AuthResult> {
  return authenticate("/api/auth/register", payload);
}

export async function logout(): Promise<LogoutResult> {
  try {
    const res = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      return {
        success: false,
        error: await responseError(res, "Could not sign out."),
      };
    }
    const data = await readJson<{ success?: boolean }>(res);
    return data?.success === false
      ? { success: false, error: "Could not sign out." }
      : { success: true };
  } catch {
    return { success: false, error: "Could not reach the authentication service." };
  }
}

export async function updateCurrentUser(payload: { fullName: string; phone?: string | null }): Promise<AuthResult> {
  try {
    const res = await fetch("/api/auth/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
    const data = await readJson<{ user?: UserProfile | null; error?: string }>(res);
    return res.ok && data?.user ? { success: true, user: data.user } : { success: false, user: null, error: data?.error ?? "Could not update the account." };
  } catch {
    return { success: false, user: null, error: "Could not reach the account service." };
  }
}

export async function fetchRooms(): Promise<RoomData[] | null> {
  try {
    const res = await fetch("/api/rooms", { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const data = await readJson<{ rooms?: RoomData[] }>(res);
    return data?.rooms ?? null;
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
      credentials: "include",
    });
    if (!res.ok) return null;
    return await readJson<AvailabilityResponse>(res);
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
      credentials: "include",
    });
    if (!res.ok) return null;
    return await readJson<ScheduleResponse>(res);
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
      { cache: "no-store", credentials: "include" }
    );
    if (!res.ok) return null;
    const data = await readJson<{
      booking?: Omit<BookingStatus, "phase">;
      phase?: BookingPhase;
    }>(res);
    if (!data?.booking || !data.phase) return null;
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
    const res = await fetch(url, { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const data = await readJson<{ equipment?: EquipmentItem[] }>(res);
    return data?.equipment ?? null;
  } catch {
    return null;
  }
}

export interface RoomEquipmentGroups {
  ready: EquipmentItem[];
  away: EquipmentItem[];
  attention: EquipmentItem[];
}

export async function fetchRoomEquipment(
  roomId: number
): Promise<RoomEquipmentGroups | null> {
  try {
    const res = await fetch(`/api/equipment/room/${roomId}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await readJson<{ groups?: RoomEquipmentGroups }>(res);
    return data?.groups ?? null;
  } catch {
    return null;
  }
}

export async function submitBooking(
  payload: BookingPayload,
  idempotencyKey = `booking-${crypto.randomUUID()}`,
): Promise<BookingResult> {
  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    const data = await readJson<{
      booking?: BookingResult["booking"];
      conflictingSlots?: string[];
      error?: string;
    }>(res);

    if (res.status === 201 && data?.booking?.bookingRef) {
      return { success: true, booking: data.booking };
    }

    if (res.status === 409) {
      return {
        success: false,
        conflictingSlots: data?.conflictingSlots ?? [],
        error: data?.error,
      };
    }

    return { success: false, error: data?.error ?? "Failed to create booking" };
  } catch {
    return {
      success: false,
      error: "Could not confirm the reservation. Check the Room Schedule before retrying; the request may have reached the server.",
    };
  }
}

export async function fetchReservations(
  filter: "upcoming" | "active" | "past" | "all" = "all",
): Promise<ReservationData[] | null> {
  try {
    const res = await fetch(`/api/bookings?filter=${encodeURIComponent(filter)}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await readJson<{ bookings?: ReservationData[] }>(res);
    return data?.bookings ?? null;
  } catch {
    return null;
  }
}

export async function fetchReservation(id: number): Promise<ReservationData | null> {
  try {
    const res = await fetch(`/api/bookings/${id}`, { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const data = await readJson<{ booking?: ReservationData }>(res);
    return data?.booking ?? null;
  } catch {
    return null;
  }
}

export interface ReservationMutationResult {
  success: boolean;
  booking?: ReservationData;
  alreadyEnded?: boolean;
  error?: string;
}

async function mutateReservation(
  id: number,
  method: "DELETE" | "PATCH",
  body?: Record<string, unknown>,
  suffix = "",
): Promise<ReservationMutationResult> {
  try {
    const res = await fetch(`/api/bookings/${id}${suffix}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await readJson<{ booking?: ReservationData; error?: string }>(res);
    return res.ok && data?.booking?.id && !data.error
      ? { success: true, booking: data?.booking }
      : { success: false, error: data?.error ?? "Reservation update failed." };
  } catch {
    return { success: false, error: "Could not reach the reservation service." };
  }
}

export function cancelReservation(id: number, version?: number): Promise<ReservationMutationResult> {
  return mutateReservation(id, "DELETE", version === undefined ? undefined : { version });
}

export function rescheduleReservation(
  id: number,
  payload: { roomId: number; date: string; endDate?: string; startTime: string; endTime: string; version: number; reason?: string },
): Promise<ReservationMutationResult> {
  return mutateReservation(id, "PATCH", payload, "/reschedule");
}

export async function endReservationSession(
  id: number,
  version?: number,
): Promise<ReservationMutationResult> {
  try {
    const res = await fetch(`/api/bookings/${id}/end-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(version === undefined ? {} : { version }),
    });
    const data = await readJson<{ booking?: ReservationData; alreadyEnded?: boolean; error?: string }>(res);
    return res.ok && data?.booking?.id && !data.error
      ? { success: true, booking: data?.booking, alreadyEnded: data?.alreadyEnded }
      : { success: false, error: data?.error ?? "Could not end the active session." };
  } catch {
    return { success: false, error: "Could not reach the reservation service." };
  }
}

export async function fetchSessionEquipmentUsage(id: number): Promise<EquipmentUsageData[] | null> {
  try {
    const res = await fetch(`/api/bookings/${id}/equipment-usage`, { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const data = await readJson<{ usage?: EquipmentUsageData[] }>(res);
    return data?.usage ?? null;
  } catch {
    return null;
  }
}

export async function submitSessionEquipmentUsage(
  id: number,
  equipmentIds: number[],
): Promise<{ success: boolean; usage?: EquipmentUsageData[]; replayed?: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/bookings/${id}/equipment-usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ equipmentIds }),
    });
    const data = await readJson<{ usage?: EquipmentUsageData[]; replayed?: boolean; error?: string }>(res);
    return res.ok && Array.isArray(data?.usage) && !data?.error
      ? { success: true, usage: data?.usage, replayed: data?.replayed }
      : { success: false, error: data?.error ?? "Could not save equipment use." };
  } catch {
    return { success: false, error: "Could not reach the session service." };
  }
}

export interface ReportData {
  id: number;
  reference: string;
  category: "equipment" | "room" | "assistance";
  equipmentId: number | null;
  equipmentName: string | null;
  roomId: number | null;
  roomName: string | null;
  locationId: number | null;
  locationName: string | null;
  bookingId: number | null;
  issueType: string | null;
  description: string;
  attachmentIds: number[];
  status: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  updates: Array<{ id: number; authorName: string | null; status: string | null; message: string | null; createdAt: string }>;
}

export async function fetchReports(all = false): Promise<ReportData[] | null> {
  try {
    const res = await fetch(`/api/reports${all ? "?mine=false" : ""}`, { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const data = await readJson<{ reports?: ReportData[] }>(res);
    return data?.reports ?? null;
  } catch {
    return null;
  }
}

export async function updateReport(id: number, payload: { status?: string; message?: string }): Promise<{ success: boolean; report?: ReportData; error?: string }> {
  try {
    const res = await fetch(`/api/reports/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
    const data = await readJson<{ report?: ReportData; error?: string }>(res);
    return res.ok && data?.report?.id && !data.error ? { success: true, report: data.report } : { success: false, error: data?.error ?? "Could not update the report." };
  } catch {
    return { success: false, error: "Could not reach the support service." };
  }
}

export async function createReport(payload: {
  category: "equipment" | "room" | "assistance";
  equipmentId?: number;
  roomId?: number;
  locationId?: number;
  bookingId?: number;
  issueType?: string;
  description: string;
  attachmentIds?: number[];
}, idempotencyKey?: string): Promise<{ success: boolean; report?: ReportData; error?: string }> {
  try {
    const res = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) }, credentials: "include", body: JSON.stringify(payload) });
    const data = await readJson<{ report?: ReportData; error?: string }>(res);
    return res.ok && data?.report?.id && data.report.reference && !data.error ? { success: true, report: data.report } : { success: false, error: data?.error ?? "Could not submit the report." };
  } catch {
    return { success: false, error: "Could not reach the support service." };
  }
}

export interface MovementData {
  id: number;
  equipmentId: number;
  equipmentCode: string;
  equipmentName: string;
  equipmentCurrentLocationId: number;
  fromLocationId: number;
  fromLocationName: string;
  toLocationId: number;
  toLocationName: string;
  status: "open" | "returned" | "corrected";
  expectedReturnAt: string | null;
  movedAt: string;
  returnedAt: string | null;
  returnLocationId: number | null;
  notes: string | null;
}

export async function fetchMovements(mine = true): Promise<MovementData[] | null> {
  try {
    const res = await fetch(`/api/movements?mine=${mine ? "true" : "false"}`, { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const data = await readJson<{ movements?: MovementData[] }>(res);
    return data?.movements ?? null;
  } catch {
    return null;
  }
}

export async function createEquipmentMovement(payload: { equipmentId: number; toLocationId: number; bookingId?: number; expectedReturnAt?: string | null; notes?: string }): Promise<{ success: boolean; movement?: MovementData; error?: string }> {
  try {
    const res = await fetch(`/api/equipment/${payload.equipmentId}/movements`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ toLocationId: payload.toLocationId, bookingId: payload.bookingId, expectedReturnAt: payload.expectedReturnAt, notes: payload.notes }) });
    const data = await readJson<{ movement?: MovementData; error?: string }>(res);
    return res.ok && data?.movement?.id && !data.error ? { success: true, movement: data.movement } : { success: false, error: data?.error ?? "Could not record the movement." };
  } catch {
    return { success: false, error: "Could not reach the equipment service." };
  }
}

export async function returnEquipmentMovement(id: number, notes?: string): Promise<{ success: boolean; movement?: MovementData; error?: string }> {
  try {
    const res = await fetch(`/api/movements/${id}/return`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ notes }) });
    const data = await readJson<{ movement?: MovementData; error?: string }>(res);
    return res.ok && data?.movement?.id && !data.error ? { success: true, movement: data.movement } : { success: false, error: data?.error ?? "Could not record the return." };
  } catch {
    return { success: false, error: "Could not reach the equipment service." };
  }
}

/** Unlike nullable legacy reads, these results distinguish empty records from failures. */
export type ApiResult<T> = { success: true; data: T } | { success: false; error: string };

async function workflowRequest<T>(
  path: string,
  valid: (data: T) => boolean,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, { cache: "no-store", credentials: "include", ...init });
    const data = await readJson<T & { error?: string }>(res);
    if (!res.ok || data?.error) return { success: false, error: data?.error ?? `Request failed (${res.status}). Please retry.` };
    if (!data || !valid(data)) return { success: false, error: "The server returned an incomplete response. Please retry." };
    return { success: true, data };
  } catch {
    return { success: false, error: "Could not reach the server. Check your connection and retry." };
  }
}

export interface JournalData {
  id: number;
  bookingId: number;
  userId: number;
  note: string;
  attachmentIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface BookingHistoryEvent {
  id: number;
  action: string;
  actorName: string | null;
  previousRoomId: number | null;
  previousDate: string | null;
  previousStartTime: string | null;
  previousEndTime: string | null;
  newRoomId: number | null;
  newDate: string | null;
  newStartTime: string | null;
  newEndTime: string | null;
  reason: string | null;
  createdAt: string;
}

export interface BookingHistoryData {
  history: BookingHistoryEvent[];
  usage: Array<Pick<EquipmentUsageData, "id" | "equipmentId" | "equipmentLabel" | "equipmentCode" | "observedLocationId" | "observedCondition" | "observedStatus" | "observedAt" | "createdAt">>;
  movements: Array<Pick<MovementData, "id" | "equipmentId" | "equipmentName" | "equipmentCode" | "fromLocationName" | "toLocationName" | "status" | "expectedReturnAt" | "movedAt" | "returnedAt">>;
  reports: Array<Pick<ReportData, "id" | "reference" | "category" | "issueType" | "description" | "attachmentIds" | "status" | "createdAt" | "updatedAt" | "resolvedAt">>;
}

function validJournal(journal: JournalData | null): boolean {
  return journal !== null && Number.isSafeInteger(journal?.id) && typeof journal.note === "string" && Array.isArray(journal.attachmentIds);
}

export function fetchBookingJournal(id: number): Promise<ApiResult<{ journal: JournalData | null }>> {
  return workflowRequest(`/api/bookings/${id}/journal`, (data: { journal: JournalData | null }) => data.journal === null || validJournal(data.journal));
}

export function saveBookingJournal(id: number, payload: { note: string; attachmentIds: number[] }): Promise<ApiResult<{ journal: JournalData }>> {
  return workflowRequest(`/api/bookings/${id}/journal`, (data: { journal: JournalData }) => validJournal(data.journal), {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
}

export function fetchBookingHistory(id: number): Promise<ApiResult<BookingHistoryData>> {
  return workflowRequest(`/api/bookings/${id}/history`, (data: BookingHistoryData) => [data.history, data.usage, data.movements, data.reports].every(Array.isArray));
}

export interface AttachmentData {
  id: number;
  fileName: string;
  mediaType: string;
  byteSize: number;
  createdAt: string;
}

export function attachmentUrl(id: number): string {
  return `/api/attachments/${id}`;
}

export function uploadAttachment(payload: { fileName: string; mediaType: string; dataUrl: string }): Promise<ApiResult<{ attachment: AttachmentData }>> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(payload.mediaType)) return Promise.resolve({ success: false, error: "Choose a JPEG, PNG, or WebP image." });
  if (payload.dataUrl.length > 500_000) return Promise.resolve({ success: false, error: "Image is too large. Choose a smaller image (about 370 KB or less)." });
  return workflowRequest("/api/attachments", (data: { attachment: AttachmentData }) => Number.isSafeInteger(data.attachment?.id) && data.attachment.id > 0, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
}

export interface PublishedPolicy {
  id: number;
  version: string;
  slotMinutes: number;
  minimumMinutes: number;
  maximumMinutes: number;
  advanceDays: number;
  openingTime: string;
  closingTime: string;
  cancellationCutoffMinutes: number;
  equipmentHandling: string;
  movementRules: string;
  publishedAt: string;
}

export interface SupportContact {
  id: number;
  name: string;
  team: string;
  email: string | null;
  phone: string | null;
  hours: string | null;
}

export function fetchPublishedPolicy(): Promise<ApiResult<{ policy: PublishedPolicy | null }>> {
  return workflowRequest("/api/policies/current", (data: { policy: PublishedPolicy | null }) => data.policy === null || Boolean(data.policy?.version && typeof data.policy.equipmentHandling === "string" && typeof data.policy.movementRules === "string"));
}

export function fetchSupportContacts(): Promise<ApiResult<{ contacts: SupportContact[] }>> {
  return workflowRequest("/api/support/contact", (data: { contacts: SupportContact[] }) => Array.isArray(data.contacts));
}

export interface PracticeProfile {
  id: number;
  code: string;
  name: string;
  category: string;
  description: string;
  version: number;
}

export interface PracticeRequirement {
  id: number;
  profileId: number;
  requirementKey: string;
  label: string;
  equipmentType: string | null;
  equipmentNamePattern: string | null;
  quantity: number;
  isHard: number;
  studentSupplied: number;
}

export interface SuitabilityCriteria {
  profile: string;
  date: string;
  startTime: string;
  endTime: string;
  partySize: number;
  amplified?: boolean;
  instrument?: string;
  bringOwnInstrument?: boolean;
}

export interface SuitabilityData {
  profile: Pick<PracticeProfile, "code" | "name" | "category" | "description">;
  criteria: SuitabilityCriteria;
  rooms: Array<{
    room: RoomData & { locationId: number | null; locationName: string | null; readinessState: string };
    suitability: "match" | "partial" | "unavailable" | "unverified";
    reasons: Array<{ code: string; message: string; requirementKey?: string }>;
    matchedEquipment: Array<{ id: number; equipmentCode: string; name: string; condition: string; status: string }>;
  }>;
}

export function fetchPracticeProfiles(): Promise<ApiResult<{ profiles: PracticeProfile[]; requirements: PracticeRequirement[] }>> {
  return workflowRequest("/api/practice-profiles", (data: { profiles: PracticeProfile[]; requirements: PracticeRequirement[] }) => Array.isArray(data.profiles) && Array.isArray(data.requirements));
}

export function fetchRoomSuitability(criteria: SuitabilityCriteria): Promise<ApiResult<SuitabilityData>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(criteria)) if (value !== undefined) query.set(key, String(value));
  return workflowRequest(`/api/rooms/suitability?${query}`, (data: SuitabilityData) => Boolean(data.profile?.code && data.criteria && Array.isArray(data.rooms) && data.rooms.every((item) => item.room?.id && ["match", "partial", "unavailable", "unverified"].includes(item.suitability) && Array.isArray(item.reasons) && Array.isArray(item.matchedEquipment))));
}

export interface LocationData { id: number; code: string; name: string; type: string }

export function fetchLocations(): Promise<ApiResult<{ locations: LocationData[] }>> {
  return workflowRequest("/api/locations", (data: { locations: LocationData[] }) => Array.isArray(data.locations));
}
