"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelReservation,
  createEquipmentMovement,
  createReport,
  endReservationSession,
  fetchEquipmentInventory,
  fetchMovements,
  fetchReports,
  fetchReservations,
  fetchRooms,
  fetchSessionEquipmentUsage,
  returnEquipmentMovement,
  rescheduleReservation,
  submitSessionEquipmentUsage,
  updateReport,
  type EquipmentItem,
  type MovementData,
  type ReportData,
  type ReservationData,
  type RoomData,
  type UserProfile,
} from "@/lib/api-client";

const card = "rounded-3xl border border-violet-200 bg-white p-5 dark:border-[#30384D] dark:bg-[#1B2133]";
const field = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-[#171D2D] dark:text-white";
const action = "min-h-11 rounded-xl border border-violet-300 px-4 py-2 font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-500/70 dark:text-violet-200 dark:hover:bg-[#211A38]";

function Panel({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return <main className="min-h-screen bg-[#f7f8fc] px-4 py-5 text-[#151a31] dark:bg-[#171D2D] dark:text-[#F5F7FF] sm:px-8 sm:py-8"><div className="mx-auto max-w-4xl"><button className="mb-5 min-h-10 text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={onBack}>← Home</button><h1 className="text-3xl font-semibold tracking-tight">{title}</h1>{children}</div></main>;
}

function State({ loading, error, empty }: { loading: boolean; error: string; empty?: string }) {
  if (loading) return <p className="mt-6 text-sm text-slate-500 dark:text-slate-300">Loading live data…</p>;
  if (error) return <p role="alert" className="mt-6 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>;
  if (empty) return <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-300">{empty}</p>;
  return null;
}

function phaseLabel(booking: ReservationData) {
  return booking.phase === "in_progress" ? "Active" : booking.phase === "completed" ? "Completed" : booking.phase === "cancelled" ? "Cancelled" : "Upcoming";
}

function ReservationCard({ booking, onChanged }: { booking: ReservationData; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [roomId, setRoomId] = useState(String(booking.roomId));
  const [date, setDate] = useState(booking.date);
  const [startTime, setStartTime] = useState(booking.startTime);
  const [endTime, setEndTime] = useState(booking.endTime);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [usage, setUsage] = useState<number[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [usageOpen, setUsageOpen] = useState(false);

  useEffect(() => {
    if (!rescheduleOpen) return;
    fetchRooms().then((value) => setRooms(value ?? []));
  }, [rescheduleOpen]);
  useEffect(() => {
    if (!usageOpen || booking.phase !== "in_progress") return;
    Promise.all([fetchSessionEquipmentUsage(booking.id), fetchEquipmentInventory()]).then(([saved, items]) => {
      setUsage((saved ?? []).map((item) => item.equipmentId));
      setEquipment(items ?? []);
    });
  }, [usageOpen, booking.id, booking.phase]);

  const run = async (operation: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true); setNotice("");
    const result = await operation();
    setBusy(false);
    if (!result.success) setNotice(result.error ?? "The operation failed. Refresh and try again.");
    else { setNotice("Saved to the server."); onChanged(); }
  };

  return <article className={card}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{booking.roomName ?? `Room ${booking.roomId}`}</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{booking.date} · {booking.startTime}–{booking.endTime}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Reference: {booking.bookingRef}</p></div><span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800 dark:bg-[#392A58] dark:text-violet-100">{phaseLabel(booking)}</span></div>{booking.cancellationReason && <p className="mt-3 text-sm">Cancellation reason: {booking.cancellationReason}</p>}{notice && <p role="status" className="mt-3 rounded-xl bg-violet-50 p-3 text-sm text-violet-800 dark:bg-[#211A38] dark:text-violet-100">{notice}</p>}<div className="mt-4 flex flex-wrap gap-2">{booking.phase === "upcoming" && <><button className={action} disabled={busy} onClick={() => void run(() => cancelReservation(booking.id, booking.version))}>Cancel</button><button className={action} disabled={busy} onClick={() => setRescheduleOpen((value) => !value)}>Reschedule</button></>}{booking.phase === "in_progress" && <><button className={action} disabled={busy} onClick={() => setUsageOpen((value) => !value)}>Log equipment used</button><button className={action} disabled={busy} onClick={() => void run(() => endReservationSession(booking.id, booking.version))}>End active session</button></>}</div>{rescheduleOpen && <form className="mt-4 grid gap-3 border-t border-slate-200 pt-4 dark:border-[#30384D] sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => rescheduleReservation(booking.id, { roomId: Number(roomId), date, startTime, endTime, version: booking.version })); }}><label className="text-sm font-semibold sm:col-span-2">Room<select className={field} value={roomId} onChange={(event) => setRoomId(event.target.value)}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label><label className="text-sm font-semibold">Date<input className={field} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="text-sm font-semibold">Start<input className={field} type="time" step="1800" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label className="text-sm font-semibold">End<input className={field} type="time" step="1800" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label><button className={`${action} sm:col-span-2`} disabled={busy}>Save reschedule</button></form>}{usageOpen && <section className="mt-4 border-t border-slate-200 pt-4 dark:border-[#30384D]"><h3 className="font-semibold">Equipment used in this session</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-300">Only present, usable equipment assigned to this room can be submitted. The first receipt is immutable.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{equipment.filter((item) => item.defaultRoomId === booking.roomId && item.status === "ready").map((item) => <label key={item.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm dark:border-[#30384D]"><input type="checkbox" checked={usage.includes(item.id)} onChange={(event) => setUsage((current) => event.target.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} />{item.name} · {item.equipmentId}</label>)}</div><button className={`${action} mt-3`} disabled={busy || usage.length === 0} onClick={() => void run(async () => { const result = await submitSessionEquipmentUsage(booking.id, usage); return result; })}>Save equipment receipt</button></section>}</article>;
}

export function LiveReservations({ user, onBack }: { user: UserProfile | null; onBack: () => void }) {
  const [items, setItems] = useState<ReservationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"upcoming" | "active" | "past">("upcoming");
  const refresh = useCallback(() => { setLoading(true); setError(""); fetchReservations("all").then((value) => { if (!value) setError("Could not load reservations from the server."); setItems(value ?? []); }).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (!user) return; const timer = window.setTimeout(refresh, 0); return () => window.clearTimeout(timer); }, [user, refresh]);
  const visible = items.filter((item) => tab === "upcoming" ? item.phase === "upcoming" : tab === "active" ? item.phase === "in_progress" : item.phase === "completed" || item.phase === "cancelled");
  return <Panel title="My Reservations" onBack={onBack}><p className="mt-2 text-slate-600 dark:text-slate-300">Upcoming, active, and historical reservations are loaded from D1.</p>{!user ? <State loading={false} error="Sign in to view your reservations." /> : <><div className="mt-6 flex gap-1 rounded-2xl bg-violet-100/70 p-1 dark:bg-[#111733]">{([["upcoming", "Upcoming"], ["active", "Active"], ["past", "History"]] as const).map(([id, label]) => <button key={id} className={`min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold ${tab === id ? "bg-white text-violet-700 shadow-sm dark:bg-[#252C3E] dark:text-violet-200" : "text-slate-600 dark:text-slate-300"}`} onClick={() => setTab(id)}>{label} ({items.filter((item) => id === "upcoming" ? item.phase === "upcoming" : id === "active" ? item.phase === "in_progress" : item.phase === "completed" || item.phase === "cancelled").length})</button>)}</div><State loading={loading} error={error} empty={!loading && !error && !visible.length ? `No ${tab === "past" ? "reservation history" : `${tab} reservations`} yet.` : undefined} /><div className="mt-4 grid gap-4 sm:grid-cols-2">{visible.map((booking) => <ReservationCard key={booking.id} booking={booking} onChanged={refresh} />)}</div></>}</Panel>;
}

export function LiveSupport({ user, onBack }: { user: UserProfile | null; onBack: () => void }) {
  const [reports, setReports] = useState<ReportData[]>([]);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [category, setCategory] = useState<"equipment" | "room" | "assistance">("equipment");
  const [equipmentId, setEquipmentId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [issueType, setIssueType] = useState("damaged");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const staff = user?.role === "technician" || user?.role === "admin";
  const refresh = useCallback(() => { if (!user) return; setLoading(true); Promise.all([fetchReports(staff), fetchRooms(), fetchEquipmentInventory()]).then(([nextReports, nextRooms, nextEquipment]) => { setReports(nextReports ?? []); setRooms(nextRooms ?? []); setEquipment(nextEquipment ?? []); }).finally(() => setLoading(false)); }, [staff, user]);
  useEffect(() => { if (!user) return; const timer = window.setTimeout(refresh, 0); return () => window.clearTimeout(timer); }, [user, refresh]);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setNotice(""); const result = await createReport({ category, equipmentId: category === "equipment" && equipmentId ? Number(equipmentId) : undefined, roomId: category === "room" && roomId ? Number(roomId) : undefined, locationId: category === "equipment" ? equipment.find((item) => String(item.id) === equipmentId)?.currentLocationId ?? undefined : undefined, issueType: category === "assistance" ? issueType : issueType, description }); if (!result.success) setNotice(result.error ?? "Could not submit the report."); else { setNotice(`Report ${result.report?.reference ?? "created"} saved on the server.`); setDescription(""); refresh(); } };
  return <Panel title="Reports & Support" onBack={onBack}><p className="mt-2 text-slate-600 dark:text-slate-300">{staff ? "FTS queue: review and update persistent student reports." : "Submit an equipment, room, or FTS assistance request and track its server status."}</p>{!user ? <State loading={false} error="Sign in to submit or view reports." /> : <><form className={`${card} mt-6 grid gap-4 sm:grid-cols-2`} onSubmit={submit}><label className="text-sm font-semibold">Request type<select className={field} value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="equipment">Equipment issue</option><option value="room">Room problem</option><option value="assistance">Contact FTS</option></select></label><label className="text-sm font-semibold">Issue type<input className={field} value={issueType} onChange={(event) => setIssueType(event.target.value)} placeholder="Missing, damaged, booking help…" required /></label>{category === "equipment" && <label className="text-sm font-semibold">Equipment<select className={field} value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} required><option value="">Choose equipment</option>{equipment.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.equipmentId}</option>)}</select></label>}{category === "room" && <label className="text-sm font-semibold">Room<select className={field} value={roomId} onChange={(event) => setRoomId(event.target.value)} required><option value="">Choose room</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>}<label className="text-sm font-semibold sm:col-span-2">Description<textarea className={`${field} min-h-28`} minLength={10} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} required placeholder="Describe what FTS should check…" /></label>{notice && <p role="status" className="sm:col-span-2 rounded-xl bg-violet-50 p-3 text-sm text-violet-800 dark:bg-[#211A38] dark:text-violet-100">{notice}</p>}<button className="min-h-11 rounded-xl bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-700 sm:col-span-2">Submit to FTS</button></form><section className="mt-6"><h2 className="text-xl font-semibold">{staff ? "Report queue" : "My requests"}</h2><State loading={loading} error="" empty={!loading && !reports.length ? "No reports or assistance requests yet." : undefined} /><div className="mt-3 grid gap-3 sm:grid-cols-2">{reports.map((report) => <article key={report.id} className={card}><div className="flex justify-between gap-3"><h3 className="font-semibold">{report.issueType ?? report.category}</h3><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{report.status}</span></div><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{report.description}</p><p className="mt-3 text-xs text-slate-500">{report.reference} · {new Date(report.createdAt).toLocaleString()}</p>{report.updates?.length > 0 && <p className="mt-2 text-sm text-violet-700 dark:text-violet-200">Latest FTS update: {report.updates.at(-1)?.message ?? "Status updated."}</p>}{staff && report.status !== "resolved" && report.status !== "closed" && <div className="mt-3 flex flex-wrap gap-2"><button className={action} onClick={async () => { const result = await updateReport(report.id, { status: "acknowledged", message: "FTS acknowledged this report." }); if (!result.success) setNotice(result.error ?? "Could not update report."); else refresh(); }}>Acknowledge</button><button className={action} onClick={async () => { const result = await updateReport(report.id, { status: "in_progress", message: "FTS is investigating this report." }); if (!result.success) setNotice(result.error ?? "Could not update report."); else refresh(); }}>Investigate</button><button className={action} onClick={async () => { const result = await updateReport(report.id, { status: "resolved", message: "FTS marked this report resolved." }); if (!result.success) setNotice(result.error ?? "Could not update report."); else refresh(); }}>Resolve</button></div>}</article>)}</div></section></>}</Panel>;
}

export function LiveMovements({ user, onBack }: { user: UserProfile | null; onBack: () => void }) {
  const [movements, setMovements] = useState<MovementData[]>([]);
  const [sessions, setSessions] = useState<ReservationData[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [selectedSession, setSelectedSession] = useState("");
  const [selectedEquipment, setSelectedEquipment] = useState("");
  const [destination, setDestination] = useState("");
  const [expectedReturnAt, setExpectedReturnAt] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(() => { if (!user) return; Promise.all([fetchMovements(true), fetchEquipmentInventory(), fetchReservations("active")]).then(([nextMoves, nextEquipment, nextSessions]) => { setMovements(nextMoves ?? []); setEquipment(nextEquipment ?? []); setSessions(nextSessions ?? []); }); }, [user]);
  useEffect(() => { if (!user) return; const timer = window.setTimeout(refresh, 0); return () => window.clearTimeout(timer); }, [user, refresh]);
  const destinations = useMemo(() => { const values = new Map<number, string>(); equipment.forEach((item) => { if (item.currentLocationId && item.currentLocationName) values.set(item.currentLocationId, item.currentLocationName); if (item.defaultLocationId && item.defaultLocationName) values.set(item.defaultLocationId, item.defaultLocationName); }); return [...values.entries()]; }, [equipment]);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setNotice(""); const result = await createEquipmentMovement({ equipmentId: Number(selectedEquipment), toLocationId: Number(destination), bookingId: selectedSession ? Number(selectedSession) : undefined, expectedReturnAt: expectedReturnAt ? new Date(expectedReturnAt).toISOString() : null }); if (!result.success) setNotice(result.error ?? "Could not record the movement."); else { setNotice("Movement saved. The expected return is an estimate, not physical availability."); setSelectedEquipment(""); refresh(); } };
  return <Panel title="My Equipment Movements" onBack={onBack}><p className="mt-2 text-slate-600 dark:text-slate-300">Record actual moves and returns. An expected return date never marks an item available automatically.</p>{!user ? <State loading={false} error="Sign in to manage equipment movements." /> : <><form className={`${card} mt-6 grid gap-4 sm:grid-cols-2`} onSubmit={submit}>{user.role === "student" && <label className="text-sm font-semibold sm:col-span-2">Active session<select className={field} value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)} required><option value="">Choose active reservation</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.roomName} · {session.date} · {session.startTime}–{session.endTime}</option>)}</select></label>}<label className="text-sm font-semibold">Equipment<select className={field} value={selectedEquipment} onChange={(event) => setSelectedEquipment(event.target.value)} required><option value="">Choose equipment</option>{equipment.filter((item) => item.status === "ready").map((item) => <option key={item.id} value={item.id}>{item.name} · {item.equipmentId}</option>)}</select></label><label className="text-sm font-semibold">Destination<select className={field} value={destination} onChange={(event) => setDestination(event.target.value)} required><option value="">Choose location</option>{destinations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label className="text-sm font-semibold">Expected return (optional)<input className={field} type="datetime-local" value={expectedReturnAt} onChange={(event) => setExpectedReturnAt(event.target.value)} /></label><button className="min-h-11 rounded-xl bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-700 sm:self-end">Record actual move</button>{notice && <p role="status" className="sm:col-span-2 rounded-xl bg-violet-50 p-3 text-sm text-violet-800 dark:bg-[#211A38] dark:text-violet-100">{notice}</p>}</form><div className="mt-6 grid gap-4 sm:grid-cols-2">{movements.map((movement) => <article className={card} key={movement.id}><div className="flex justify-between gap-3"><h2 className="font-semibold">{movement.equipmentName}</h2><span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800 dark:bg-[#392A58] dark:text-violet-100">{movement.status === "open" ? "In use" : movement.status}</span></div><p className="mt-2 text-sm">{movement.fromLocationName} → {movement.toLocationName}</p>{movement.expectedReturnAt && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Expected return: {new Date(movement.expectedReturnAt).toLocaleString()}</p>}{movement.status === "open" && <button className={`${action} mt-4`} onClick={async () => { const result = await returnEquipmentMovement(movement.id); if (!result.success) setNotice(result.error ?? "Could not record the return."); else { setNotice("Return saved on the server."); refresh(); } }}>Record return</button>}</article>)}</div><State loading={false} error="" empty={!movements.length ? "No equipment movements recorded by you yet." : undefined} /></>}</Panel>;
}
