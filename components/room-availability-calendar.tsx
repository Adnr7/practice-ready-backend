"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { fetchAvailability, fetchReservations, fetchRooms, type AvailabilityResponse, type ReservationData, type RoomData } from "@/lib/api-client";
import { getInstitutionNow, timeToMinutes } from "@/lib/booking-engine";

const ROW_HEIGHT = 64;
const ROOM_ORDER = ["MPR 2", "MPR 3", "MPR 4", "MPR 5", "MP Lab 2", "Live Room", "Studio"];
const control = "min-h-11 rounded-xl border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-700 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:!bg-transparent hover:!bg-violet-50 dark:border-slate-600 dark:bg-[#1B2133] dark:text-violet-200 dark:hover:!bg-[#211A38]";
const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromKey = (value: string) => { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); };
const addDays = (value: string, amount: number) => { const date = fromKey(value); date.setDate(date.getDate() + amount); return dateKey(date); };
const dateLabel = (value: string) => fromKey(value).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const clock = (minutes: number) => new Date(2000, 0, 1, 0, minutes).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const slotLabel = (index: number) => `${clock(index * 30)}–${clock((index + 1) * 30)}`;
const epoch = (date: string, time: string, endDate = date, isEnd = false) => { const end = fromKey(endDate); if (isEnd && time === "00:00" && endDate === date) end.setDate(end.getDate() + 1); const [hours, minutes] = time.split(":").map(Number); return Date.UTC(end.getFullYear(), end.getMonth(), end.getDate(), hours, minutes); };
const bookingBounds = (booking: ReservationData) => ({ start: epoch(booking.date, booking.startTime), end: epoch(booking.date, booking.endTime, booking.endDate ?? booking.date, true) });

type RoomState = { room: RoomData; availability: AvailabilityResponse };

export default function RoomAvailabilityCalendar({ onSelect, onHome, onReservation }: { onSelect?: (room: string, date: Date, index: number) => void; onHome?: () => void; onReservation?: (reservation: ReservationData) => void }) {
  const initialDate = getInstitutionNow().date;
  const [date, setDate] = useState(initialDate);
  const [room, setRoom] = useState(ROOM_ORDER[0]);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [states, setStates] = useState<RoomState[]>([]);
  const [reservations, setReservations] = useState<ReservationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const savedScroll = useRef({ top: 0, left: 0 });

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setLoading(true); setError(""); } });
    const load = async () => {
      const [roomList, reservationList] = await Promise.all([fetchRooms(), fetchReservations("all")]);
      const ordered = ROOM_ORDER.map((name) => roomList?.find((entry) => entry.name === name)).filter((entry): entry is RoomData => Boolean(entry));
      const loaded = await Promise.all(ordered.map(async (found) => {
        const availability = await fetchAvailability(found.id, date);
        return availability ? { room: found, availability } : null;
      }));
      if (cancelled) return;
      const complete = loaded.filter((entry): entry is RoomState => Boolean(entry));
      if (!roomList || ordered.length !== ROOM_ORDER.length || complete.length !== ROOM_ORDER.length) { setError("Could not load live room availability. Please try again later."); setLoading(false); return; }
      setRooms(ordered); setStates(complete); setReservations(reservationList ?? []); setRoom((current) => ordered.some((entry) => entry.name === current) ? current : ordered[0].name); setLoading(false);
    };
    void load().catch(() => { if (!cancelled) { setError("Could not load live room availability. Please try again later."); setLoading(false); } });
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [date]);

  useLayoutEffect(() => { if (scroll.current) { scroll.current.scrollTop = savedScroll.current.top; scroll.current.scrollLeft = savedScroll.current.left; } if (expanded) exitButton.current?.focus({ preventScroll: true }); }, [expanded]);
  useEffect(() => { if (!expanded) return; const previous = document.body.style.overflow; const button = expandButton.current; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; button?.focus({ preventScroll: true }); }; }, [expanded]);

  const toggleExpanded = (next: boolean) => { if (scroll.current) savedScroll.current = { top: scroll.current.scrollTop, left: scroll.current.scrollLeft }; setExpanded(next); };
  const move = (amount: number) => setDate((current) => addDays(current, amount));
  const roomsForDisplay = rooms.length ? rooms : ROOM_ORDER.map((name) => ({ id: 0, name, code: name, capacity: 0, description: "" }));
  const loadedByRoom = new Map(states.map((entry) => [entry.room.name, entry]));
  const stateFor = (name: string, index: number) => {
    const loaded = loadedByRoom.get(name);
    const slot = loaded?.availability.slots.find((entry) => timeToMinutes(entry.startTime) === index * 30);
    const own = loaded && reservations.find((booking) => booking.roomId === loaded.room.id && booking.status === "confirmed" && (() => { const bounds = bookingBounds(booking); const start = epoch(date, slot?.startTime ?? `${pad(Math.floor(index / 2))}:${index % 2 ? "30" : "00"}`); const end = start + 30 * 60_000; return bounds.start < end && bounds.end > start; })());
    if (own) return { kind: "own" as const, label: "Your booking", reservation: own };
    if (!slot || slot.status !== "available") return { kind: "booked" as const, label: "Booked" };
    if (slot.passed || epoch(date, slot.endTime, date, true) <= now) return { kind: "past" as const, label: "Elapsed" };
    return { kind: "free" as const, label: "Available" };
  };
  const renderColumn = (name: string) => <div className="relative border-l border-slate-300 dark:border-slate-500" style={{ height: 48 * ROW_HEIGHT }}>{Array.from({ length: 48 }, (_, index) => {
    const state = stateFor(name, index);
    if (state.kind === "booked" || state.kind === "own") {
      const previous = index > 0 ? stateFor(name, index - 1) : null;
      if (previous?.kind === state.kind && previous.reservation?.id === state.reservation?.id) return null;
      let end = index + 1; while (end < 48) { const next = stateFor(name, end); if (next.kind !== state.kind || next.reservation?.id !== state.reservation?.id) break; end += 1; }
      return <button type="button" key={index} onClick={() => state.reservation && onReservation?.(state.reservation)} disabled={!state.reservation || !onReservation} aria-label={`${name}, ${state.label}, ${slotLabel(index)}`} style={{ top: index * ROW_HEIGHT + 2, height: (end - index) * ROW_HEIGHT - 4 }} className={`absolute inset-x-1 overflow-hidden rounded-lg border !px-2 !py-1 text-left text-xs disabled:!opacity-100 enabled:hover:bg-violet-50 dark:enabled:hover:bg-[#302348] ${state.kind === "own" ? "border-violet-500 bg-violet-200 text-violet-950 dark:border-violet-400 dark:bg-[#4A326E] dark:text-violet-100" : "border-slate-500 bg-slate-200 text-slate-800 dark:border-[#8190AC] dark:bg-[#3B465E] dark:text-slate-100"}`}><div className="absolute inset-x-2" style={{ top: Math.min(Math.max(4, scrollTop - index * ROW_HEIGHT + 4), Math.max(4, (end - index) * ROW_HEIGHT - 52)) }}><p className="truncate font-semibold">{state.label}</p><p className="text-[11px] leading-4">{slotLabel(index)}{end - index > 1 ? ` · ${slotLabel(end - 1).split("–")[1]}` : ""}</p></div></button>;
    }
    const eligible = state.kind === "free" && Boolean(onSelect);
    return <button type="button" key={index} disabled={!eligible} onClick={() => { if (eligible) onSelect?.(name, fromKey(date), index); }} aria-label={`${name}, ${dateLabel(date)}, ${slotLabel(index)}, ${state.label}${eligible ? ", select to book" : ""}`} style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }} className={`absolute inset-x-0 w-full rounded-none border-b border-slate-300 !px-2 text-xs dark:border-slate-500 ${state.kind === "past" ? "practice-calendar-past !border-slate-400 !bg-slate-50 !text-slate-400 dark:!bg-[#171D2D] dark:!text-slate-500" : "!bg-white !text-violet-700 enabled:hover:!bg-violet-50 dark:!bg-[#1B2133] dark:!text-violet-200 dark:enabled:hover:!bg-[#211A38]"}`}>{state.kind !== "past" && <span className="practice-calendar-label relative z-20 bg-white px-1 dark:bg-[#1B2133]">{state.label}</span>}</button>;
  })}</div>;
  return <div data-calendar-expanded={expanded ? "true" : undefined} className={expanded ? "fixed inset-0 z-[45] flex h-[100dvh] flex-col overflow-hidden bg-white text-[#151a31] dark:bg-[#1B2133] dark:text-slate-100" : "space-y-3"}>
    <style>{`.practice-calendar-past{background-image:repeating-linear-gradient(135deg,transparent 0,transparent 8px,rgba(100,116,139,.09) 8px,rgba(100,116,139,.09) 9px)}.dark .practice-calendar-past{background-image:repeating-linear-gradient(135deg,transparent 0,transparent 8px,rgba(148,163,184,.13) 8px,rgba(148,163,184,.13) 9px)}`}</style>
    {!expanded && <div className="space-y-3"><div className="flex items-center justify-between gap-3"><p className="min-w-0 text-sm text-slate-600 dark:text-slate-300">Select an available half-hour slot.</p>{onHome && <button type="button" onClick={onHome} className="hidden min-h-11 rounded-xl px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 dark:text-violet-300 lg:block">Home</button>}</div><div className="flex flex-wrap items-center gap-2"><button className={control} onClick={() => move(-1)} aria-label="Previous date">‹</button><button className={control} onClick={() => setDate(initialDate)}>Today</button><button className={control} onClick={() => move(1)} aria-label="Next date">›</button><input type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} className={`${control} min-w-[170px]`} aria-label="Choose calendar date" /></div><div className="lg:hidden"><label className="flex items-center gap-3 text-sm font-semibold">Room<select className="mt-1 min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-[#1B2133]" value={room} onChange={(event) => setRoom(event.target.value)}>{roomsForDisplay.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></label></div><div className="flex shrink-0 items-end justify-between gap-3"><div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600 dark:text-slate-300"><span className="font-semibold">Legend</span>{[["Available", "border-slate-300 bg-white dark:border-slate-500 dark:bg-[#1B2133]"], ["Booked", "border-slate-500 bg-slate-200 dark:border-[#8190AC] dark:bg-[#3B465E]"], ["Your booking", "border-violet-500 bg-violet-200 dark:border-violet-400 dark:bg-[#4A326E]"], ["Past", "practice-calendar-past border-slate-400 bg-slate-50 dark:border-slate-500 dark:bg-[#171D2D]"]].map(([label, colour]) => <span key={label} className="inline-flex items-center gap-2 whitespace-nowrap"><span className={`h-3.5 w-3.5 rounded-full border ${colour}`} />{label}</span>)}</div><button ref={expandButton} type="button" onClick={() => toggleExpanded(true)} aria-label="Expand calendar to full screen" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-white text-violet-700 dark:border-slate-600 dark:bg-[#1B2133] dark:text-violet-200"><Maximize2 size={16} /></button></div></div>}
    {expanded && <><button ref={exitButton} type="button" onClick={() => toggleExpanded(false)} aria-label="Exit full screen calendar" className="absolute right-2 top-1.5 z-40 grid h-11 w-11 place-items-center rounded-xl border border-violet-200 bg-white text-violet-700 dark:border-slate-600 dark:bg-[#1B2133] dark:text-violet-200"><Minimize2 size={16} /></button><div className="absolute left-4 top-1.5 z-40 text-sm font-semibold">Room availability · {dateLabel(date)}</div></>}
    {loading && <p role="status" className="rounded-2xl border border-violet-100 bg-violet-50 p-4 text-sm text-violet-800 dark:border-violet-500/30 dark:bg-[#211A38] dark:text-violet-200">Loading live availability…</p>}
    {error && <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-800 dark:bg-[#321820] dark:text-rose-200">{error}</p>}
    {!loading && !error && <div ref={scroll} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} tabIndex={0} aria-label="Room availability timetable" style={expanded ? { flex: "1 1 0%", minHeight: 0 } : undefined} className={`${expanded ? "h-full rounded-none border-0" : "max-h-[65dvh] rounded-2xl border border-slate-200 dark:border-slate-700"} overflow-auto bg-white dark:bg-[#1B2133]`}><div className="lg:min-w-[1200px]"><div className="sticky top-0 z-30 grid grid-cols-[76px_repeat(7,minmax(0,1fr))] bg-white dark:bg-[#1B2133]"><div className="p-3 text-xs text-slate-500">Time</div>{roomsForDisplay.map((entry) => <div key={entry.name} className={`border-b border-l border-slate-200 p-3 text-center text-xs font-semibold dark:border-slate-700 ${entry.name !== room ? "max-lg:hidden" : ""}`}>{entry.name}</div>)}</div><div className="grid grid-cols-[76px_repeat(7,minmax(0,1fr))]"><div>{Array.from({ length: 48 }, (_, index) => <div key={index} style={{ height: ROW_HEIGHT }} className="border-b border-slate-100 px-2 pt-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">{clock(index * 30)}</div>)}</div>{roomsForDisplay.map((entry) => <div key={entry.name} className={entry.name !== room ? "max-lg:hidden" : ""}>{renderColumn(entry.name)}</div>)}</div></div></div>}
  </div>;
}
