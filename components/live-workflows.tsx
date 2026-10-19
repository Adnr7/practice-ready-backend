"use client";

import { useCallback, useRef, useState } from "react";
import {
  cancelReservation, createEquipmentMovement, createReport, endReservationSession,
  fetchEquipmentInventory, fetchMovements, fetchReports, fetchReservations,
  fetchRooms, fetchSessionEquipmentUsage, returnEquipmentMovement, rescheduleReservation,
  submitSessionEquipmentUsage, updateReport,
  type EquipmentItem, type EquipmentUsageData, type MovementData, type ReportData,
  type ReservationData, type UserProfile,
} from "@/lib/api-client";
import { AttachmentEditor, AttachmentGallery } from "./live-attachments";
import { action, card, field, MutationState, Panel, primary, required, State, timestamp, useLiveData, useMutation } from "./live-common";
import { BookingDetails } from "./live-journal";
import type { MovementDestination } from "@/lib/movement-permissions";

function phaseLabel(booking: ReservationData) {
  return booking.phase === "in_progress" ? "Active" : booking.phase === "completed" ? "Completed" : booking.phase === "cancelled" ? "Cancelled" : "Upcoming";
}

function RescheduleForm({ booking, busy, onSave }: { booking: ReservationData; busy: boolean; onSave: (payload: { roomId: number; date: string; startTime: string; endTime: string; version: number }) => void }) {
  const load = useCallback(() => required(fetchRooms(), "rooms for rescheduling"), []);
  const query = useLiveData(load);
  const [roomId, setRoomId] = useState(String(booking.roomId));
  const [date, setDate] = useState(booking.date);
  const [startTime, setStartTime] = useState(booking.startTime);
  const [endTime, setEndTime] = useState(booking.endTime);
  return <div className="mt-4 border-t border-slate-200 pt-4 dark:border-[#30384D]"><State loading={query.loading} error={query.error} onRetry={() => void query.reload()} empty={query.data?.length === 0 ? "No rooms are available for rescheduling." : undefined} />{query.data && !query.error && query.data.length > 0 && <form onSubmit={(event) => { event.preventDefault(); if (!busy) onSave({ roomId: Number(roomId), date, startTime, endTime, version: booking.version }); }}><fieldset disabled={busy || query.loading} className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold sm:col-span-2">Room<select className={field} required value={roomId} onChange={(event) => setRoomId(event.target.value)}>{!query.data.some((room) => room.id === Number(roomId)) && <option value="">Choose room</option>}{query.data.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label className="text-sm font-semibold">Date<input className={field} type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="text-sm font-semibold">Start<input className={field} type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label className="text-sm font-semibold">End<input className={field} type="time" required value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label><button className={primary} disabled={busy}>{busy ? "Saving…" : "Save new time"}</button></fieldset></form>}</div>;
}

function UsageEditor({ items, saved, busy, onSave }: { items: EquipmentItem[]; saved: EquipmentUsageData[]; busy: boolean; onSave: (ids: number[]) => void }) {
  const [selected, setSelected] = useState<number[]>([]);
  const logged = new Set(saved.map((item) => item.equipmentId));
  return <form className="mt-3" onSubmit={(event) => { event.preventDefault(); if (!busy && selected.length) onSave(selected); }}><fieldset disabled={busy}><legend className="text-sm font-semibold">Equipment used in this session</legend><p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Previously logged observations are retained. Select additional items you actually used.</p><div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{items.map((item) => <label key={item.id} className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4" disabled={logged.has(item.id)} checked={logged.has(item.id) || selected.includes(item.id)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, item.id] : value.filter((id) => id !== item.id))} /><span>{item.name} · {item.equipmentId}{logged.has(item.id) ? " · Already logged" : ` · ${item.currentLocationName ?? "Location unknown"}`}</span></label>)}</div>{!items.length && <State empty="No equipment is available to log." />}<button className={`${primary} mt-4`} disabled={busy || !selected.length}>{busy ? "Saving…" : "Save equipment use"}</button></fieldset></form>;
}

function UsageForm({ bookingId, busy, onSave }: { bookingId: number; busy: boolean; onSave: (ids: number[]) => void }) {
  const load = useCallback(async () => { const [saved, items] = await Promise.all([required(fetchSessionEquipmentUsage(bookingId), "saved equipment use"), required(fetchEquipmentInventory(), "equipment inventory")]); return { saved, items }; }, [bookingId]);
  const query = useLiveData(load);
  return <div className="mt-4 border-t border-slate-200 pt-4 dark:border-[#30384D]"><State loading={query.loading} error={query.error} onRetry={() => void query.reload()} />{query.data && !query.error && <UsageEditor {...query.data} busy={busy} onSave={onSave} />}</div>;
}

function ReservationCard({ booking, user, onChanged }: { booking: ReservationData; user: UserProfile; onChanged: () => void }) {
  const mutation = useMutation();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  return <article className={card}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{booking.roomName ?? `Room ${booking.roomId}`}</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{booking.date} · {booking.startTime}–{booking.endTime}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Reference: {booking.bookingRef}</p>{booking.policyVersion && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Booked under policy: {booking.policyVersion}</p>}</div><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800 dark:bg-[#392A58] dark:text-violet-100">{phaseLabel(booking)}</span></div>{booking.cancellationReason && <p className="mt-3 text-sm">Cancellation reason: {booking.cancellationReason}</p>}<MutationState {...mutation} />
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={action} disabled={mutation.busy} aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen ? "Close history & journal" : "Open history & journal"}</button>{booking.phase === "upcoming" && <><button type="button" className={action} disabled={mutation.busy} onClick={() => void mutation.run(() => cancelReservation(booking.id, booking.version), "Reservation cancelled.", onChanged)}>Cancel</button><button type="button" className={action} disabled={mutation.busy} aria-expanded={rescheduleOpen} onClick={() => setRescheduleOpen((value) => !value)}>Reschedule</button></>}{booking.phase === "in_progress" && <><button type="button" className={action} disabled={mutation.busy} aria-expanded={usageOpen} onClick={() => setUsageOpen((value) => !value)}>Log equipment used</button><button type="button" className={action} disabled={mutation.busy} onClick={() => void mutation.run(() => endReservationSession(booking.id, booking.version), "Session ended on the server.", onChanged)}>End active session</button></>}</div>
    {rescheduleOpen && booking.phase === "upcoming" && <RescheduleForm booking={booking} busy={mutation.busy} onSave={(payload) => void mutation.run(() => rescheduleReservation(booking.id, payload), "Reservation rescheduled.", () => { setRescheduleOpen(false); onChanged(); })} />}
    {usageOpen && booking.phase === "in_progress" && <UsageForm bookingId={booking.id} busy={mutation.busy} onSave={(ids) => void mutation.run(() => submitSessionEquipmentUsage(booking.id, ids), "Equipment use saved.", () => { setUsageOpen(false); onChanged(); })} />}
    {detailsOpen && <BookingDetails booking={booking} user={user} />}
  </article>;
}

function Reservations({ user }: { user: UserProfile }) {
  const load = useCallback(() => required(fetchReservations("all"), "reservations"), []);
  const query = useLiveData(load);
  const [tab, setTab] = useState<"upcoming" | "active" | "past">("upcoming");
  const items = query.data ?? [];
  const inTab = (item: ReservationData, id: typeof tab) => id === "upcoming" ? item.phase === "upcoming" : id === "active" ? item.phase === "in_progress" : item.phase === "completed" || item.phase === "cancelled";
  const visible = items.filter((item) => inTab(item, tab));
  return <><div className="mt-6 flex gap-1 rounded-2xl bg-violet-100/70 p-1 dark:bg-[#111733]">{([["upcoming", "Upcoming"], ["active", "Active"], ["past", "History"]] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} className={`min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold ${tab === id ? "bg-white text-violet-700 shadow-sm dark:bg-[#252C3E] dark:text-violet-200" : "text-slate-600 dark:text-slate-300"}`} onClick={() => setTab(id)}>{label}{query.data && !query.error ? ` (${items.filter((item) => inTab(item, id)).length})` : ""}</button>)}</div><div className="mt-3"><button type="button" className={action} disabled={query.loading} onClick={() => void query.reload()}>Refresh reservations</button></div><State loading={query.loading} error={query.error} onRetry={() => void query.reload()} empty={!visible.length ? `No ${tab === "past" ? "reservation history" : `${tab} reservations`} yet.` : undefined} />{!query.error && <div className="mt-4 grid gap-4">{visible.map((booking) => <ReservationCard key={booking.id} booking={booking} user={user} onChanged={() => void query.reload()} />)}</div>}</>;
}

export function LiveReservations({ user, onBack }: { user: UserProfile | null; onBack: () => void }) {
  return <Panel title="My Reservations" onBack={onBack}><p className="mt-2 text-slate-600 dark:text-slate-300">Manage live reservations and reopen your history, journal, images, and linked session records.</p>{user ? <Reservations key={user.id} user={user} /> : <State error="Sign in to view your reservations." />}</Panel>;
}

function ReportCard({ report, staff, onChanged }: { report: ReportData; staff: boolean; onChanged: () => void }) {
  const [status, setStatus] = useState(report.status);
  const [message, setMessage] = useState("");
  const mutation = useMutation();
  return <article className={card}><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{report.reference}</h3><span className="text-sm font-semibold text-violet-700 dark:text-violet-300">{report.status.replaceAll("_", " ")}</span></div><p className="mt-2 text-sm">{report.category} · {report.issueType ?? "Assistance"} · {timestamp(report.createdAt)}</p>{(report.equipmentName || report.roomName || report.locationName) && <p className="mt-1 text-sm">{[report.equipmentName, report.roomName, report.locationName].filter(Boolean).join(" · ")}</p>}{report.bookingId && <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">Linked reservation ID: {report.bookingId}</p>}<p className="mt-3 whitespace-pre-wrap text-sm">{report.description}</p><AttachmentGallery ids={report.attachmentIds} /><ul className="mt-3 space-y-2 text-sm">{report.updates.map((update) => <li key={update.id} className="border-l-2 border-violet-200 pl-3 dark:border-violet-800"><p>{update.message || update.status?.replaceAll("_", " ") || "Status update"}</p><p className="text-xs text-slate-500 dark:text-slate-300">{update.authorName ?? "Support"} · {timestamp(update.createdAt)}</p></li>)}</ul>{staff && <form className="mt-4" onSubmit={(event) => { event.preventDefault(); void mutation.run(() => updateReport(report.id, { status, ...(message.trim() ? { message: message.trim() } : {}) }), "Report update saved.", () => { setMessage(""); onChanged(); }); }}><fieldset disabled={mutation.busy} className="grid gap-3"><label className="text-sm font-semibold">Status<select className={field} value={status} onChange={(event) => setStatus(event.target.value)}>{["open", "acknowledged", "in_progress", "resolved", "closed", "reopened"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label className="text-sm font-semibold">Update message<textarea className={field} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} /></label><button className={action} disabled={mutation.busy || (status === report.status && !message.trim())}>{mutation.busy ? "Saving…" : "Save report update"}</button></fieldset></form>}<MutationState {...mutation} /></article>;
}

function Support({ user }: { user: UserProfile }) {
  const staff = user.role === "technician" || user.role === "admin";
  const loadReports = useCallback(() => required(fetchReports(staff), "reports"), [staff]);
  const reports = useLiveData(loadReports);
  const loadOptions = useCallback(async () => { const [rooms, equipment, bookings] = await Promise.all([required(fetchRooms(), "rooms"), required(fetchEquipmentInventory(), "equipment"), required(fetchReservations("all"), "reservations for report linking")]); return { rooms, equipment, bookings }; }, []);
  const options = useLiveData(loadOptions);
  const [category, setCategory] = useState<"equipment" | "room" | "assistance">("equipment");
  const [equipmentId, setEquipmentId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [issueType, setIssueType] = useState("damaged");
  const [description, setDescription] = useState("");
  const [ids, setIds] = useState<number[]>([]);
  const [uploading, setUploading] = useState(false);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const mutation = useMutation();
  return <><p className="mt-2 text-slate-600 dark:text-slate-300">{staff ? "Review and update persistent student reports." : "Submit an issue or assistance request with images and track its server status."}</p><section className={`${card} mt-6`}><h2 className="text-xl font-semibold">Submit a report</h2><State loading={options.loading} error={options.error} onRetry={() => void options.reload()} /><form className="mt-4" onSubmit={(event) => {
    event.preventDefault();
    if (uploading || options.loading || options.error || !options.data) return;
    const payload = { category, equipmentId: category === "equipment" && equipmentId ? Number(equipmentId) : undefined, roomId: category === "room" && roomId ? Number(roomId) : undefined, locationId: category === "equipment" ? options.data.equipment.find((item) => String(item.id) === equipmentId)?.currentLocationId ?? undefined : undefined, bookingId: bookingId ? Number(bookingId) : undefined, issueType: issueType.trim(), description: description.trim(), attachmentIds: ids };
    const fingerprint = JSON.stringify(payload);
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: `report-${crypto.randomUUID()}` };
    const key = retry.current.key;
    void mutation.run(() => createReport(payload, key), "Report saved on the server.", () => { retry.current = null; setDescription(""); setIds([]); void reports.reload(); });
  }}><fieldset disabled={mutation.busy || options.loading || !!options.error || !options.data} className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Request type<select className={field} value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="equipment">Equipment issue</option><option value="room">Room problem</option><option value="assistance">Contact FTS</option></select></label><label className="text-sm font-semibold">Issue type<input className={field} value={issueType} onChange={(event) => setIssueType(event.target.value)} maxLength={120} required placeholder="Missing, damaged, booking help…" /></label>{category === "equipment" && <label className="text-sm font-semibold">Equipment<select className={field} value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} required><option value="">Choose equipment</option>{options.data?.equipment.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.equipmentId}</option>)}</select></label>}{category === "room" && <label className="text-sm font-semibold">Room<select className={field} value={roomId} onChange={(event) => setRoomId(event.target.value)} required><option value="">Choose room</option>{options.data?.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>}<label className="text-sm font-semibold sm:col-span-2">Link reservation (optional)<select className={field} value={bookingId} onChange={(event) => setBookingId(event.target.value)}><option value="">No linked reservation</option>{options.data?.bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.bookingRef} · {booking.roomName ?? `Room ${booking.roomId}`} · {booking.date}</option>)}</select></label><label className="text-sm font-semibold sm:col-span-2">Description<textarea className={`${field} min-h-28`} minLength={1} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} required placeholder="Describe what FTS should check…" /></label><div className="sm:col-span-2"><AttachmentEditor ids={ids} onChange={setIds} disabled={mutation.busy} onBusyChange={setUploading} /></div><button className={primary} disabled={mutation.busy || uploading || !description.trim()}>{mutation.busy ? "Submitting…" : "Submit report"}</button></fieldset></form><MutationState {...mutation} /></section><section className="mt-6"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">{staff ? "Support queue" : "My reports"}</h2><button type="button" className={action} disabled={reports.loading} onClick={() => void reports.reload()}>Refresh reports</button></div><State loading={reports.loading} error={reports.error} onRetry={() => void reports.reload()} empty={reports.data?.length === 0 ? "No reports have been submitted yet." : undefined} />{reports.data && !reports.error && <div className="mt-4 grid gap-4">{reports.data.map((report) => <ReportCard key={`${report.id}-${report.updatedAt}`} report={report} staff={staff} onChanged={() => void reports.reload()} />)}</div>}</section></>;
}

export function LiveSupport({ user, onBack }: { user: UserProfile | null; onBack: () => void }) {
  return <Panel title="Reports & Support" onBack={onBack}>{user ? <Support key={user.id} user={user} /> : <State error="Sign in to submit or view reports." />}</Panel>;
}

function MovementCard({ movement, onChanged }: { movement: MovementData; onChanged: () => void }) {
  const mutation = useMutation();
  return <article className={card}><h2 className="font-semibold">{movement.equipmentName} · {movement.equipmentCode}</h2><p className="mt-2 text-sm">{movement.fromLocationName} → {movement.toLocationName} · {movement.status}</p><p className="mt-1 text-sm">Moved: {timestamp(movement.movedAt)}</p><p className="mt-1 text-sm">{movement.returnedAt ? `Returned: ${timestamp(movement.returnedAt)}` : `Expected return (estimate): ${timestamp(movement.expectedReturnAt)}`}</p>{movement.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{movement.notes}</p>}{movement.status === "open" && <button type="button" className={`${action} mt-4`} disabled={mutation.busy} onClick={() => void mutation.run(() => returnEquipmentMovement(movement.id), "Return recorded on the server.", onChanged)}>{mutation.busy ? "Recording return…" : "Record actual return"}</button>}<MutationState {...mutation} /></article>;
}

function Movements({ user }: { user: UserProfile }) {
  const load = useCallback(() => required(fetchMovements(true), "equipment movements"), []);
  const query = useLiveData(load);
  const loadOptions = useCallback(async () => { const [equipment, sessions] = await Promise.all([required(fetchEquipmentInventory(), "equipment inventory"), required(fetchReservations("active"), "active reservations")]); return { equipment, sessions }; }, []);
  const inventory = useLiveData(loadOptions);
  const [selectedSession, updateSession] = useState("");
  const [selectedEquipment, updateEquipment] = useState("");
  const [destination, setDestination] = useState("");
  const [expectedReturnAt, setExpectedReturnAt] = useState("");
  const mutation = useMutation();
  const setSelectedSession = (value: string) => { updateSession(value); updateEquipment(""); setDestination(""); };
  const setSelectedEquipment = (value: string) => { updateEquipment(value); setDestination(""); };
  const scope = `${selectedEquipment}:${user.role === "student" ? selectedSession : "staff"}`;
  const loadDestinations = useCallback(async () => {
    if (!selectedEquipment || (user.role === "student" && !selectedSession)) return { scope, locations: [] as MovementDestination[] };
    const response = await fetch(`/api/equipment/${selectedEquipment}/movements${user.role === "student" ? `?bookingId=${selectedSession}` : ""}`, { credentials: "include", cache: "no-store" });
    const data = await response.json().catch(() => null) as { destinations?: MovementDestination[]; error?: string } | null;
    if (!response.ok || !Array.isArray(data?.destinations)) throw new Error(data?.error ?? "Could not load approved movement destinations. Please retry.");
    return { scope, locations: data.destinations };
  }, [selectedEquipment, selectedSession, user.role, scope]);
  const destinations = useLiveData(loadDestinations);
  const session = inventory.data?.sessions.find((item) => item.id === Number(selectedSession));
  const options = { ...inventory, data: inventory.data ? { ...inventory.data, equipment: inventory.data.equipment.filter((item) => user.role !== "student" || item.defaultRoomId === session?.roomId), locations: destinations.data?.scope === scope && !destinations.error && !destinations.loading ? destinations.data.locations : [] } : null };
  const selected = options.data?.equipment.find((item) => item.id === Number(selectedEquipment));
  const unavailable = options.loading || !!options.error || !options.data || (user.role === "student" && !options.data.sessions.length);
  return <><section className={`${card} mt-6`}><h2 className="text-xl font-semibold">Record an actual move</h2>{user.role === "student" && <p className="mt-2 text-sm">Only staff-designated destinations are offered. Return equipment within three hours and before your active session ends.</p>}<State loading={options.loading} error={options.error} onRetry={() => void options.reload()} empty={user.role === "student" && options.data?.sessions.length === 0 ? "You need an active reservation before recording a student equipment movement." : undefined} />{selectedEquipment && <State loading={destinations.loading} error={destinations.error} onRetry={() => { setDestination(""); void destinations.reload(); }} empty={destinations.data?.scope === scope && !destinations.data.locations.length ? "No destinations are approved for this equipment. Contact FTS for assistance." : undefined} />}<form className="mt-4" onSubmit={(event) => {
    event.preventDefault();
    if (unavailable || !selected || !options.data?.locations.some((location) => location.id === Number(destination))) return;
    void mutation.run(() => createEquipmentMovement({ equipmentId: Number(selectedEquipment), toLocationId: Number(destination), bookingId: selectedSession ? Number(selectedSession) : undefined, expectedReturnAt: expectedReturnAt ? new Date(expectedReturnAt).toISOString() : null }), "Movement saved. The expected return is an estimate, not physical availability.", () => { setSelectedEquipment(""); void query.reload(); void options.reload(); });
  }}><fieldset disabled={mutation.busy || unavailable} className="grid gap-4 sm:grid-cols-2">{user.role === "student" && <label className="text-sm font-semibold sm:col-span-2">Active session<select className={field} value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)} required><option value="">Choose active reservation</option>{options.data?.sessions.map((session) => <option key={session.id} value={session.id}>{session.roomName} · {session.date} · {session.startTime}–{session.endTime}</option>)}</select></label>}<label className="text-sm font-semibold">Equipment<select className={field} value={selectedEquipment} onChange={(event) => setSelectedEquipment(event.target.value)} required><option value="">Choose equipment</option>{options.data?.equipment.filter((item) => item.status === "ready").map((item) => <option key={item.id} value={item.id}>{item.name} · {item.equipmentId}</option>)}</select></label><label className="text-sm font-semibold">Destination<select className={field} value={destination} onChange={(event) => setDestination(event.target.value)} required><option value="">Choose location</option>{options.data?.locations.filter((location) => location.id !== selected?.currentLocationId).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="text-sm font-semibold">Expected return{user.role === "student" ? " (required)" : " (optional)"}<input className={field} type="datetime-local" value={expectedReturnAt} onChange={(event) => setExpectedReturnAt(event.target.value)} required={user.role === "student"} /></label><button className={`${primary} sm:self-end`} disabled={mutation.busy}>{mutation.busy ? "Recording…" : "Record actual move"}</button></fieldset></form><MutationState {...mutation} /></section><section className="mt-6"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">My recorded movements</h2><button type="button" className={action} disabled={query.loading} onClick={() => void query.reload()}>Refresh movements</button></div><State loading={query.loading} error={query.error} onRetry={() => void query.reload()} empty={query.data?.length === 0 ? "No equipment movements recorded yet." : undefined} />{query.data && !query.error && <div className="mt-4 grid gap-4">{query.data.map((movement) => <MovementCard key={movement.id} movement={movement} onChanged={() => { void query.reload(); void options.reload(); }} />)}</div>}</section></>;
}

export function LiveMovements({ user, onBack }: { user: UserProfile | null; onBack: () => void }) {
  return <Panel title="My Equipment Movements" onBack={onBack}><p className="mt-2 text-slate-600 dark:text-slate-300">Record actual moves and returns. An expected return date never marks an item available automatically.</p>{user ? <Movements key={user.id} user={user} /> : <State error="Sign in to manage equipment movements." />}</Panel>;
}
