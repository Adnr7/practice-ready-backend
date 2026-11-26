"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { fetchStaffAudit, type AuditEventData } from "@/lib/api-client";

const pageSize = 50;
const actions = [
  ["booked", "Room booked"], ["rescheduled", "Reservation rescheduled"],
  ["cancelled", "Reservation cancelled"], ["session_ended", "Session ended"],
  ["equipment_moved", "Equipment moved"], ["equipment_returned", "Equipment returned"],
  ["equipment_movement_corrected", "Movement corrected"],
  ["equipment_movement_updated", "Movement updated"],
  ["session_equipment_logged", "Session equipment logged"],
] as const;
const field = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-[#171D2D]";
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-300 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-500/60 dark:text-violet-200 dark:hover:bg-[#211A38]";

type Payload = Record<string, unknown>;
const detailsFor = (event: AuditEventData): Payload => {
  try {
    const value: unknown = JSON.parse(event.details);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Payload : {};
  } catch { return {}; }
};
const text = (data: Payload, key: string) => typeof data[key] === "string" || typeof data[key] === "number" ? String(data[key]) : "";
const labelFor = (action: string) => actions.find(([key]) => key === action)?.[1] ?? action.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
const escapeCsv = (value: unknown) => {
  let text = String(value ?? "");
  if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export default function StaffActivityLog() {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const [events, setEvents] = useState<AuditEventData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (requestOffset = offset) => {
    setLoading(true);
    setError("");
    if (from && to && from > to) { setEvents([]); setTotal(0); setError("The start date must be on or before the end date."); setLoading(false); return; }
    const result = await fetchStaffAudit({ q: query.trim() || undefined, from: from || undefined, to: to || undefined, action: action || undefined, limit: pageSize, offset: requestOffset });
    if (!result.success) {
      setEvents([]); setTotal(0); setError(result.error);
    } else {
      setEvents(result.data.events); setTotal(result.data.total);
    }
    setLoading(false);
  }, [action, from, offset, query, to]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(offset); }, 0); return () => window.clearTimeout(timer); }, [load, offset]);
  const applyFilters = () => { setOffset(0); void load(0); };

  const exportCsv = async () => {
    if (from && to && from > to) { setError("The start date must be on or before the end date."); return; }
    setExporting(true); setError("");
    const all: AuditEventData[] = [];
    let expected = 0;
    for (let start = 0; start < 100_000; start += 100) {
      const result = await fetchStaffAudit({ q: query.trim() || undefined, from: from || undefined, to: to || undefined, action: action || undefined, limit: 100, offset: start });
      if (!result.success) { setError(`CSV export failed: ${result.error}`); setExporting(false); return; }
      expected = result.data.total;
      all.push(...result.data.events);
      if (all.length >= expected || result.data.events.length === 0) break;
    }
    if (all.length < expected) { setError(`Export stopped after ${all.length.toLocaleString()} of ${expected.toLocaleString()} events. Narrow the filters and retry.`); setExporting(false); return; }
    const headings = ["Timestamp", "Actor", "Actor email", "Action", "Student", "Student email", "Room", "Date", "Start", "End", "Equipment", "Equipment ID", "From", "To", "Reservation reference", "Reason", "Details"];
    const rows = all.map((event) => {
      const detail = detailsFor(event);
      const equipment = Array.isArray(detail.equipment) ? detail.equipment.map((value) => value && typeof value === "object" ? text(value as Payload, "name") : "").filter(Boolean).join("; ") : text(detail, "equipmentName");
      const equipmentId = Array.isArray(detail.equipment) ? detail.equipment.map((value) => value && typeof value === "object" ? text(value as Payload, "id") : "").filter(Boolean).join("; ") : text(detail, "equipmentId");
      return [event.createdAt, event.actorName ?? "Unknown", event.actorEmail ?? "", labelFor(event.action), text(detail, "studentName"), text(detail, "studentEmail"), text(detail, "roomName"), text(detail, "date"), text(detail, "startTime"), text(detail, "endTime"), equipment, equipmentId, text(detail, "fromLocation"), text(detail, "toLocation"), text(detail, "bookingRef") || text(detail, "reservationId"), event.reason ?? "", JSON.stringify(detail)];
    });
    const csv = [headings, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `practice-ready-activity-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
    setExporting(false);
  };

  return <section className="space-y-5" aria-label="Reservation and equipment activity log">
    <header><h3 className="text-lg font-semibold">Reservation &amp; equipment activity</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Server-recorded bookings, schedule changes, cancellations, session endings, equipment movements, returns, and equipment logged during a session.</p></header>
    <div className="grid gap-3 rounded-2xl border border-violet-200 bg-white p-4 dark:border-[#30384D] dark:bg-[#1B2133] sm:grid-cols-2 xl:grid-cols-5">
      <label className="text-sm font-semibold sm:col-span-2 xl:col-span-1">Search<input className={`${field} mt-1 font-normal`} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyFilters(); }} placeholder="Student, room, equipment, reference"/></label>
      <label className="text-sm font-semibold">From<input type="date" className={`${field} mt-1 font-normal`} value={from} onChange={(event) => setFrom(event.target.value)}/></label>
      <label className="text-sm font-semibold">To<input type="date" className={`${field} mt-1 font-normal`} value={to} onChange={(event) => setTo(event.target.value)}/></label>
      <label className="text-sm font-semibold">Activity type<select className={`${field} mt-1 font-normal`} value={action} onChange={(event) => setAction(event.target.value)}><option value="">All activity</option>{actions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-1"><button className={`${button} flex-1`} onClick={applyFilters} disabled={loading}>Apply</button><button className={button} onClick={() => void load(offset)} aria-label="Refresh activity log" disabled={loading}><RefreshCw size={17} aria-hidden="true"/></button></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600 dark:text-slate-300" role="status">{loading ? "Loading activity…" : `${total.toLocaleString()} ${total === 1 ? "event" : "events"}${total ? ` · showing ${offset + 1}–${Math.min(offset + events.length, total).toLocaleString()}` : ""}`}</p><button className={button} onClick={() => void exportCsv()} disabled={exporting || loading || total === 0}><Download size={17} aria-hidden="true"/>{exporting ? "Preparing CSV…" : "Export all matching CSV"}</button></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">{error}</p>}
    <div className="space-y-3">{events.map((event) => {
      const detail = detailsFor(event);
      const reservation = text(detail, "bookingRef") || text(detail, "reservationId") || (event.entityType === "reservation" ? event.entityId : "");
      const equipment = text(detail, "equipmentName");
      const equipmentId = text(detail, "equipmentId");
      const student = text(detail, "studentName");
      const range = [text(detail, "startTime"), text(detail, "endTime")].filter(Boolean).join("–");
      return <article key={event.id} className="rounded-2xl border border-violet-200 bg-white p-4 dark:border-[#30384D] dark:bg-[#1B2133]">
        <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="font-semibold">{labelFor(event.action)}</h4><time className="text-xs text-slate-500 dark:text-slate-300" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST</time></div>
        <dl className="mt-3 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <div><dt className="text-xs text-slate-500 dark:text-slate-300">{event.entityType === "reservation" || event.action === "session_equipment_logged" ? "Student / booker" : "Initiated by"}</dt><dd className="mt-1 break-words font-medium">{student || event.actorName || "Unknown student"}{text(detail, "studentEmail") ? ` · ${text(detail, "studentEmail")}` : ""}</dd></div>
          <div><dt className="text-xs text-slate-500 dark:text-slate-300">Room &amp; time</dt><dd className="mt-1 break-words">{[text(detail, "roomName"), text(detail, "date"), range].filter(Boolean).join(" · ") || "—"}</dd></div>
          {text(detail, "previousRoomName") && <div><dt className="text-xs text-slate-500 dark:text-slate-300">Previous room &amp; time</dt><dd className="mt-1 break-words">{[text(detail, "previousRoomName"), text(detail, "previousDate"), [text(detail, "previousStartTime"), text(detail, "previousEndTime")].filter(Boolean).join("–")].filter(Boolean).join(" · ")}</dd></div>}
          <div><dt className="text-xs text-slate-500 dark:text-slate-300">Reservation</dt><dd className="mt-1 break-words">{reservation}</dd></div>
          {(equipment || equipmentId) && <div><dt className="text-xs text-slate-500 dark:text-slate-300">Equipment</dt><dd className="mt-1 break-words">{equipment || "Equipment"}{equipmentId ? ` · ${equipmentId}` : ""}</dd></div>}
          {(text(detail, "fromLocation") || text(detail, "toLocation")) && <div><dt className="text-xs text-slate-500 dark:text-slate-300">Movement</dt><dd className="mt-1 break-words">{text(detail, "fromLocation")} → {text(detail, "toLocation")}</dd></div>}
          {text(detail, "expectedReturnAt") && <div><dt className="text-xs text-slate-500 dark:text-slate-300">Estimated return</dt><dd className="mt-1 break-words">{new Date(text(detail, "expectedReturnAt")).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST</dd></div>}
          {text(detail, "observedAt") && <div><dt className="text-xs text-slate-500 dark:text-slate-300">Equipment observed</dt><dd className="mt-1 break-words">{new Date(text(detail, "observedAt")).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST{text(detail, "equipmentLocation") ? ` · ${text(detail, "equipmentLocation")}` : ""}</dd></div>}
          <div><dt className="text-xs text-slate-500 dark:text-slate-300">Recorded by</dt><dd className="mt-1 break-words">{event.actorName || "Unknown"}{event.actorEmail ? ` · ${event.actorEmail}` : ""}</dd></div>
          {event.reason && <div className="sm:col-span-2 xl:col-span-3"><dt className="text-xs text-slate-500 dark:text-slate-300">Reason / note</dt><dd className="mt-1 break-words whitespace-pre-wrap">{event.reason}</dd></div>}
          {event.action === "session_equipment_logged" && <div><dt className="text-xs text-slate-500 dark:text-slate-300">Observed condition</dt><dd className="mt-1">{[text(detail, "condition"), text(detail, "status")].filter(Boolean).join(" · ") || "—"}</dd></div>}
        </dl>
      </article>;
    })}</div>
    {!loading && !error && events.length === 0 && <p className="rounded-2xl border border-violet-200 bg-white p-6 text-center text-sm text-slate-600 dark:border-[#30384D] dark:bg-[#1B2133] dark:text-slate-300">No activity matches these filters.</p>}
    <nav aria-label="Activity log pages" className="flex items-center justify-between gap-3"><button className={button} onClick={() => setOffset(Math.max(0, offset - pageSize))} disabled={offset === 0 || loading}>Previous</button><span className="text-sm text-slate-600 dark:text-slate-300">Page {Math.floor(offset / pageSize) + 1} of {Math.max(1, Math.ceil(total / pageSize))}</span><button className={button} onClick={() => setOffset(offset + pageSize)} disabled={offset + pageSize >= total || loading}>Next</button></nav>
  </section>;
}
