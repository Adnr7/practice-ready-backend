"use client";

import { useCallback, useState, type ReactNode } from "react";
import { login, logout, type PracticeProfile, type PracticeRequirement, type PublishedPolicy, type ReportData, type ReservationData, type SupportContact, type UserProfile } from "@/lib/api-client";
import type { getStaffOperations, StaffEquipment } from "@/lib/staff-operations";
import type { MovementPermission } from "@/lib/movement-permissions";
import { AttachmentGallery } from "./live-attachments";
import { action, card, field, MutationState, Panel, primary, State, timestamp, useLiveData, useMutation } from "./live-common";

type Operations = Awaited<ReturnType<typeof getStaffOperations>>;
type Room = Operations["rooms"][number];
type Repair = Operations["repairs"][number];
type Reload = () => void;
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const grid = "grid gap-3 sm:grid-cols-2";
const stages = ["reported", "assessing", "awaiting_parts", "in_repair", "awaiting_inspection", "completed"];

async function request<T>(path: string, method: Method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: "include", cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const value: unknown = await response.json().catch(() => null);
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!response.ok || !data || data.error) throw new Error(typeof data?.error === "string" ? data.error : `Request failed (${response.status}). Refresh and retry.`);
  return data as T;
}

const str = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const num = (data: FormData, key: string) => Number(str(data, key));
const optionalId = (data: FormData, key: string) => str(data, key) ? num(data, key) : null;
const dateTime = (data: FormData, key: string) => str(data, key) ? new Date(str(data, key)).toISOString() : null;
function localTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function Text({ label, name, value = "", type = "text", required = false, min, max, maxLength = 200 }: { label: string; name: string; value?: string | number | null; type?: string; required?: boolean; min?: number; max?: number; maxLength?: number }) {
  return <label className="text-sm font-semibold">{label}<input className={field} name={name} type={type} defaultValue={value ?? ""} required={required} min={min} max={max} maxLength={maxLength} step={type === "time" ? 1800 : undefined} /></label>;
}

function Area({ label, name, value, required = false }: { label: string; name: string; value?: string | null; required?: boolean }) {
  return <label className="text-sm font-semibold sm:col-span-2">{label}<textarea className={field} name={name} defaultValue={value ?? ""} required={required} maxLength={4000} rows={3} /></label>;
}

function Select({ label, name, value, options, optional = false }: { label: string; name: string; value?: string | number | null; options: Array<{ id: string | number; name: string }>; optional?: boolean }) {
  return <label className="text-sm font-semibold">{label}<select className={field} name={name} defaultValue={value ?? ""} required={!optional}>{optional ? <option value="">None</option> : <option value="" disabled>Choose…</option>}{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
}

function SaveForm({ children, onSave, onChanged, label = "Save changes", reset = false }: { children: ReactNode; onSave: (data: FormData) => Promise<unknown>; onChanged?: Reload; label?: string; reset?: boolean }) {
  const mutation = useMutation();
  return <form className="mt-4" onSubmit={(event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void mutation.run(async () => { await onSave(data); return { success: true }; }, "Saved on the server.", () => { if (reset) form.reset(); onChanged?.(); });
  }}><fieldset disabled={mutation.busy} className={grid}>{children}<button className={`${primary} sm:col-span-2`} disabled={mutation.busy}>{mutation.busy ? "Saving…" : label}</button></fieldset><MutationState {...mutation} /></form>;
}

function Reason() { return <Text label="Reason (at least 5 characters)" name="reason" required maxLength={1000} />; }
function ChoiceList({ values }: { values: string[] }) { return values.map((id) => ({ id, name: id.replaceAll("_", " ") })); }

export function LiveStaff({ user, onUserChange, onBack, onMovements }: { user: UserProfile | null; onUserChange: (user: UserProfile | null) => void; onBack: Reload; onMovements: Reload }) {
  const mutation = useMutation();
  return <Panel title="Staff Workspace" onBack={onBack}>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Live FTS operations · technicians and administrators.</p>
    {!user ? <section className={`${card} mt-5`}><h2 className="text-lg font-semibold">Staff sign in</h2><SaveForm label="Sign in" onSave={async (data) => {
      const result = await login({ email: str(data, "email"), password: String(data.get("password") ?? "") });
      if (!result.success || !result.user) throw new Error(result.error ?? "Sign in failed.");
      onUserChange(result.user);
    }}><Text label="Email" name="email" type="email" required /><Text label="Password" name="password" type="password" required maxLength={1000} /></SaveForm></section> : <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm">{user.fullName} · {user.role}</p><button className={action} disabled={mutation.busy} onClick={() => void mutation.run(logout, "Signed out.", () => onUserChange(null))}>Sign out</button></div><MutationState {...mutation} />
      {user.role === "student" ? <State error="This account does not have staff access. Sign out and use a technician or administrator account." /> : <Workspace key={user.id} user={user} onMovements={onMovements} />}
    </>}
  </Panel>;
}

function Workspace({ user, onMovements }: { user: UserProfile; onMovements: Reload }) {
  const [tab, setTab] = useState("reports");
  const load = useCallback(() => request<Operations>("/api/staff/operations"), []);
  const query = useLiveData(load);
  const reload = () => void query.reload();
  return <>
    <nav aria-label="Staff sections" className="mt-6 flex flex-wrap gap-2">{[["reports", "Reports"], ["rooms", "Rooms & closures"], ["catalog", "Catalog"], ["repairs", "Repairs & inspections"], ["reservations", "Reservations"], ["configuration", "Configuration"], ["lookup", "Students & audit"]].map(([id, label]) => <button key={id} className={tab === id ? primary : action} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}<button className={action} onClick={onMovements}>Movements ↗</button></nav>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500 dark:text-slate-300">Closure and ETA inputs use your browser timezone. Reservation times use institution time (UTC+05:30).</p><button className={action} disabled={query.loading} onClick={reload}>Refresh workspace</button></div>
    <State loading={query.loading} error={query.error} onRetry={reload} />
    {query.data && !query.error && <div className="mt-5 space-y-4">
      {tab === "reports" && <Reports operations={query.data} onChanged={reload} />}
      {tab === "rooms" && <Rooms operations={query.data} onChanged={reload} admin={user.role === "admin"} />}
      {tab === "catalog" && <Catalog operations={query.data} onChanged={reload} />}
      {tab === "repairs" && <Repairs operations={query.data} onChanged={reload} />}
      {tab === "reservations" && <Reservations operations={query.data} />}
      {tab === "configuration" && <Configuration admin={user.role === "admin"} operations={query.data} />}
      {tab === "lookup" && <Lookup />}
    </div>}
  </>;
}

function Catalog({ operations, onChanged }: { operations: Operations; onChanged: Reload }) {
  const [roomId, setRoomId] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const room = operations.rooms.find((item) => item.id === Number(roomId));
  const equipment = operations.equipment.find((item) => item.id === Number(equipmentId));
  return <>
    <section className={card}><h2 className="text-xl font-semibold">Room catalog</h2><p className="mt-2 text-sm">Create, edit or archive rooms. Archival preserves history and refuses rooms with future reservations.</p><label className="mt-3 block text-sm font-semibold">Edit room<select className={field} value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">Create room</option>{operations.rooms.map((item) => <option key={item.id} value={item.id}>{item.name}{!item.isActive ? " (archived)" : ""}</option>)}</select></label><RoomCatalogForm key={roomId} room={room} operations={operations} onChanged={onChanged} /></section>
    <section className={card}><h2 className="text-xl font-semibold">Equipment catalog</h2><p className="mt-2 text-sm">Catalog edits are audited. Record physical moves in Movements and verification in Inspections.</p><label className="mt-3 block text-sm font-semibold">Edit equipment<select className={field} value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)}><option value="">Create equipment</option>{operations.equipment.map((item) => <option key={item.id} value={item.id}>{item.equipmentId} · {item.name}{item.archived ? " (archived)" : ""}</option>)}</select></label><EquipmentCatalogForm key={equipmentId} equipment={equipment} operations={operations} onChanged={onChanged} /></section>
  </>;
}

function RoomCatalogForm({ room, operations, onChanged }: { room?: Room; operations: Operations; onChanged: Reload }) {
  return <SaveForm onChanged={onChanged} onSave={(data) => request("/api/staff/operations", room ? "PATCH" : "POST", {
    ...(room ? { id: room.id } : {}), name: str(data, "name"), code: str(data, "code"), capacity: num(data, "capacity"), description: str(data, "description"), locationId: num(data, "locationId"), isActive: data.get("isActive") === "on", reason: str(data, "reason"),
  })} label={room ? "Save room catalog" : "Create room"}>
    <Text label="Room name" name="name" value={room?.name} required /><Text label="Code (lowercase-hyphenated)" name="code" value={room?.code} required maxLength={80} />
    <Text label="Capacity" name="capacity" type="number" min={1} max={1000} value={room?.capacity ?? 6} required /><Select label="Physical location" name="locationId" value={room?.locationId} options={operations.locations} />
    <Area label="Description" name="description" value={room?.description} required /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={room?.isActive ?? true} />Active room (uncheck to archive)</label><Reason />
  </SaveForm>;
}

function EquipmentCatalogForm({ equipment, operations, onChanged }: { equipment?: StaffEquipment; operations: Operations; onChanged: Reload }) {
  return <SaveForm onChanged={onChanged} onSave={(data) => request(equipment ? `/api/equipment/${equipment.id}` : "/api/equipment", equipment ? "PATCH" : "POST", {
    equipmentId: str(data, "equipmentId"), name: str(data, "name"), type: str(data, "type"), modelName: str(data, "modelName") || null, condition: str(data, "condition"), status: str(data, "status"), defaultLocationId: optionalId(data, "defaultLocationId"), defaultRoomId: optionalId(data, "defaultRoomId"), notes: str(data, "notes") || null, archived: data.get("archived") === "on", reason: str(data, "reason"), ...(equipment ? {} : { currentLocationId: num(data, "currentLocationId") }),
  })} label={equipment ? "Save equipment catalog" : "Create equipment"}>
    <Text label="Equipment code" name="equipmentId" value={equipment?.equipmentId} required /><Text label="Name" name="name" value={equipment?.name} required />
    <Text label="Type (e.g. mixer, mic, keyboard)" name="type" value={equipment?.type} required /><Text label="Model" name="modelName" value={equipment?.modelName} />
    <Text label="Condition (not an inspection)" name="condition" value={equipment?.condition ?? "Unknown"} required maxLength={500} /><Select label="Status" name="status" value={equipment?.status ?? "attention"} options={ChoiceList({ values: ["ready", "away", "attention", "service", "missing"] })} />
    <Select label="Default location" name="defaultLocationId" value={equipment?.defaultLocationId} options={operations.locations} optional /><Select label="Default room" name="defaultRoomId" value={equipment?.defaultRoomId} options={operations.rooms} optional />
    {!equipment && <Select label="Current physical location" name="currentLocationId" options={operations.locations} />}
    {equipment && <p className="text-sm">Current location: {operations.locations.find((location) => location.id === equipment.currentLocationId)?.name ?? "Unknown"} · Last inspected: {timestamp(equipment.lastInspectedAt)}</p>}
    <Area label="Notes" name="notes" value={equipment?.notes} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="archived" defaultChecked={Boolean(equipment?.archived)} />Archived</label><Reason />
  </SaveForm>;
}

function Rooms({ operations, onChanged, admin }: { operations: Operations; onChanged: Reload; admin: boolean }) {
  return <>{operations.rooms.length === 0 && <State empty="No rooms yet. Create a room in Catalog." />}{operations.rooms.map((room) => <article key={room.id} className={card}>
    <h2 className="text-xl font-semibold">{room.name} · {room.readinessState}{!room.isActive ? " · archived" : ""}</h2><p className="mt-1 text-sm">{room.locationName ?? "Location unverified"} · Capacity {room.capacity} · Last verified {timestamp(room.readinessVerifiedAt)}</p>
    <SaveForm onChanged={onChanged} onSave={(data) => request(`/api/staff/rooms/${room.id}`, "PATCH", { readinessState: str(data, "readinessState"), readinessNotes: str(data, "readinessNotes") })} label="Save readiness"><Select label="Readiness" name="readinessState" value={room.readinessState} options={ChoiceList({ values: ["usable", "restricted", "closed", "unknown"] })} /><Area label="Readiness notes / reason" name="readinessNotes" value={room.readinessNotes} required /></SaveForm>
    <details className="mt-5"><summary className="cursor-pointer font-semibold">Restrictions & scheduled closure</summary>
      <ul className="mt-3 space-y-2 text-sm">{room.restrictions.map((restriction) => <li key={restriction.id}>{restriction.activityKey} · {restriction.state} · {restriction.explanation}</li>)}</ul>
      <SaveForm onChanged={onChanged} label="Save activity restriction" onSave={(data) => request(`/api/staff/rooms/${room.id}`, "PATCH", { restriction: { activityKey: str(data, "activityKey"), state: str(data, "state"), explanation: str(data, "explanation") } })}><Text label="Activity key (e.g. vocal-amplified)" name="activityKey" required /><Select label="Activity state" name="state" value="restricted" options={ChoiceList({ values: ["allowed", "restricted", "unsupported", "unknown"] })} /><Area label="Explanation" name="explanation" required /></SaveForm>
      <SaveForm onChanged={onChanged} label="Publish closure" reset onSave={(data) => request(`/api/staff/rooms/${room.id}/closures`, "POST", { startsAt: dateTime(data, "startsAt"), endsAt: dateTime(data, "endsAt"), reason: str(data, "reason") })}><Text label="Closure start" name="startsAt" type="datetime-local" required /><Text label="Closure end" name="endsAt" type="datetime-local" required /><Reason /></SaveForm>
      {room.activeClosures.map((closure) => <div className="mt-4 rounded-xl border border-violet-200 p-3 dark:border-slate-600" key={closure.id}><p className="text-sm">Closure #{closure.id} · {timestamp(closure.startsAt)}–{timestamp(closure.endsAt)} · {closure.reason}</p><SaveForm onChanged={onChanged} label="Cancel closure" onSave={(data) => request(`/api/staff/room-closures/${closure.id}`, "PATCH", { reason: str(data, "reason") })}><Reason /></SaveForm></div>)}
    </details>
    {admin && <RoomProfile room={room} operations={operations} onChanged={onChanged} />}
  </article>)}</>;
}

function RoomProfile({ room, operations, onChanged }: { room: Room; operations: Operations; onChanged: Reload }) {
  const load = useCallback(() => request<{ profiles: PracticeProfile[] }>("/api/practice-profiles"), []);
  const profiles = useLiveData(load);
  return <details className="mt-5"><summary className="cursor-pointer font-semibold">Practice profile support (admin)</summary><State error={profiles.error} loading={profiles.loading} onRetry={() => void profiles.reload()} /><ul className="mt-2 text-sm">{operations.roomProfiles.filter((item) => item.roomId === room.id).map((item) => <li key={item.profileId}>{profiles.data?.profiles.find((profile) => profile.id === item.profileId)?.name ?? `Profile ${item.profileId}`} · {item.state} · {item.explanation}</li>)}</ul>{profiles.data && <SaveForm onChanged={onChanged} onSave={(data) => request(`/api/staff/rooms/${room.id}/profiles`, "PUT", { profileId: num(data, "profileId"), state: str(data, "state"), explanation: str(data, "explanation") })}><Select label="Profile" name="profileId" options={profiles.data.profiles} /><Select label="Support state" name="state" value="supported" options={ChoiceList({ values: ["supported", "restricted", "unsupported", "unknown"] })} /><Area label="Explanation" name="explanation" required /></SaveForm>}</details>;
}

function Reports({ operations, onChanged }: { operations: Operations; onChanged: Reload }) {
  const load = useCallback(() => request<{ reports: ReportData[] }>("/api/reports?mine=false"), []);
  const query = useLiveData(load);
  const [filter, setFilter] = useState("unresolved");
  const reload = () => { void query.reload(); onChanged(); };
  const visible = query.data?.reports.filter((report) => filter === "all" || (filter === "unresolved" ? !["resolved", "closed"].includes(report.status) : report.status === filter)) ?? [];
  return <><div className="flex flex-wrap gap-3"><label className="text-sm font-semibold">Report filter<select className={field} value={filter} onChange={(event) => setFilter(event.target.value)}>{["unresolved", "all", "open", "acknowledged", "in_progress", "resolved", "closed", "reopened"].map((status) => <option key={status}>{status}</option>)}</select></label><button className={action} disabled={query.loading} onClick={reload}>Refresh reports</button></div><State loading={query.loading} error={query.error} onRetry={reload} empty={!visible.length ? "No reports match this filter." : undefined} />{!query.error && visible.map((report) => <ReportCard key={`${report.id}-${report.updatedAt}-${report.status}`} report={report} operations={operations} onChanged={reload} />)}</>;
}

function ReportCard({ report, operations, onChanged }: { report: ReportData; operations: Operations; onChanged: Reload }) {
  const available = [...(report.category === "equipment" && report.equipmentId ? ["repair"] : []), ...(report.roomId ? ["closure"] : [])];
  const [targetAction, setTargetAction] = useState(available[0] ?? "");
  const link = operations.reportLinks.find((item) => item.reportId === report.id);
  return <article className={card}><h2 className="text-lg font-semibold">{report.reference} · {report.status.replaceAll("_", " ")}</h2><p className="mt-1 text-sm">{[report.equipmentName, report.roomName, report.locationName].filter(Boolean).join(" · ") || report.category}</p><p className="mt-3 whitespace-pre-wrap text-sm">{report.description}</p><AttachmentGallery ids={report.attachmentIds} />
    <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">History ({report.updates.length})</summary><ul className="mt-2 space-y-2 text-sm">{report.updates.map((update) => <li key={update.id} className="border-l-2 border-violet-200 pl-3">{update.message ?? update.status} · {update.authorName ?? "Staff"} · {timestamp(update.createdAt)}</li>)}</ul></details>
    <SaveForm label="Save triage update" onChanged={onChanged} onSave={(data) => request(`/api/reports/${report.id}`, "PATCH", { status: str(data, "status"), message: str(data, "message") })}><Select label="Report status" name="status" value={report.status} options={ChoiceList({ values: ["open", "acknowledged", "in_progress", "resolved", "closed", "reopened"] })} /><Area label="Public update" name="message" required /></SaveForm>
    {available.length > 0 && !["resolved", "closed"].includes(report.status) && <details className="mt-5"><summary className="cursor-pointer font-semibold">Link repair or room closure atomically</summary>
      <p className="mt-2 text-sm">A report can be linked once. Resolve reservations before closing a room. The reason appears in the public report history.</p>
      <label className="mt-3 block text-sm font-semibold">Action<select className={field} value={targetAction} onChange={(event) => setTargetAction(event.target.value)}>{available.map((value) => <option key={value} value={value}>{value === "repair" ? "Open equipment repair" : "Publish room closure"}</option>)}</select></label>
      {link ? <p className="mt-3 text-sm">Linked to {link.action} #{link.linkedId}. Continue in {link.action === "repair" ? "Repairs & inspections" : "Rooms & closures"}.</p> : <SaveForm onChanged={onChanged} label={targetAction === "repair" ? "Open linked repair" : "Publish linked closure"} onSave={(data) => request(`/api/staff/reports/${report.id}/action`, "POST", { action: targetAction, expectedUpdatedAt: report.updatedAt, expectedStatus: report.status, reason: str(data, "reason"), ...(targetAction === "repair" ? { expectedReturnAt: dateTime(data, "expectedReturnAt"), privateNote: str(data, "privateNote") || null } : { startsAt: dateTime(data, "startsAt"), endsAt: dateTime(data, "endsAt") }) })}>
        {targetAction === "repair" ? <><Text label="Expected return (optional)" name="expectedReturnAt" type="datetime-local" /><Area label="Private technician note" name="privateNote" /></> : <><Text label="Closure start" name="startsAt" type="datetime-local" required /><Text label="Closure end" name="endsAt" type="datetime-local" required /></>}<Reason />
      </SaveForm>}
    </details>}
  </article>;
}

function InspectionForm({ operations, onChanged, repair }: { operations: Operations; onChanged: Reload; repair?: Repair }) {
  return <SaveForm onChanged={onChanged} label="Record inspection" reset onSave={(data) => request(`/api/staff/equipment/${repair?.equipmentId ?? num(data, "equipmentId")}/inspections`, "POST", { result: str(data, "result"), condition: str(data, "condition"), notes: str(data, "notes"), ...(repair ? { repairJobId: repair.id } : {}) })}>
    {!repair && <Select label="Equipment" name="equipmentId" options={operations.equipment.filter((item) => !item.archived)} />}<Select label="Inspection result" name="result" value="passed" options={ChoiceList({ values: ["passed", "failed"] })} /><Text label="Observed condition" name="condition" required maxLength={500} /><Area label="Inspection notes" name="notes" />
  </SaveForm>;
}

function Repairs({ operations, onChanged }: { operations: Operations; onChanged: Reload }) {
  const [showCompleted, setShowCompleted] = useState(false);
  const visible = operations.repairs.filter((repair) => showCompleted || repair.stage !== "completed");
  return <>
    <section className={card}><h2 className="text-xl font-semibold">Open a standalone repair</h2><p className="mt-2 text-sm">For an existing report, use Reports to retain its atomic link and audit trail.</p><SaveForm onChanged={onChanged} label="Open repair" reset onSave={(data) => request(`/api/staff/equipment/${num(data, "equipmentId")}/repairs`, "POST", { expectedReturnAt: dateTime(data, "expectedReturnAt"), publicMessage: str(data, "publicMessage"), privateNote: str(data, "privateNote") })}><Select label="Equipment" name="equipmentId" options={operations.equipment.filter((item) => !item.archived)} /><Text label="Expected return (optional)" name="expectedReturnAt" type="datetime-local" /><Area label="Public update" name="publicMessage" required /><Area label="Private technician note" name="privateNote" /></SaveForm></section>
    <section className={card}><details><summary className="cursor-pointer text-lg font-semibold">Record standalone equipment inspection</summary><InspectionForm operations={operations} onChanged={onChanged} /></details></section>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />Include completed repairs (latest 200 jobs)</label>
    {!visible.length && <State empty="No repairs in this view." />}{visible.map((repair) => <RepairCard key={`${repair.id}-${repair.stage}-${repair.expectedReturnAt}`} repair={repair} operations={operations} onChanged={onChanged} />)}
  </>;
}

function RepairCard({ repair, operations, onChanged }: { repair: Repair; operations: Operations; onChanged: Reload }) {
  const passed = operations.inspections.filter((inspection) => inspection.equipmentId === repair.equipmentId && inspection.result === "passed" && inspection.repairJobId === repair.id);
  return <article className={card}><h2 className="text-lg font-semibold">Repair #{repair.id} · {repair.equipmentName} · {repair.stage.replaceAll("_", " ")}</h2><p className="mt-1 text-sm">ETA: {repair.expectedReturnAt ? timestamp(repair.expectedReturnAt) : "Not yet known"}{repair.sourceReportId ? ` · Report #${repair.sourceReportId}` : ""}</p>{repair.publicMessage && <p className="mt-2 text-sm">Public: {repair.publicMessage}</p>}{repair.privateNote && <p className="mt-2 text-sm">Private: {repair.privateNote}</p>}
    {repair.stage !== "completed" && <><SaveForm onChanged={onChanged} label="Update repair" onSave={(data) => request(`/api/staff/repairs/${repair.id}`, "PATCH", { stage: str(data, "stage"), expectedReturnAt: dateTime(data, "expectedReturnAt"), publicMessage: str(data, "publicMessage"), privateNote: str(data, "privateNote"), ...(str(data, "inspectionId") ? { inspectionId: num(data, "inspectionId") } : {}) })}><Select label="Repair stage" name="stage" value={repair.stage} options={ChoiceList({ values: stages.slice(stages.indexOf(repair.stage)) })} /><Text label="Expected return (blank = unknown)" name="expectedReturnAt" value={localTime(repair.expectedReturnAt)} type="datetime-local" /><Select label="Passed inspection (required for completion)" name="inspectionId" optional options={passed.map((inspection) => ({ id: inspection.id, name: `#${inspection.id} · ${timestamp(inspection.observedAt)} · ${inspection.condition}` }))} /><Area label="Public update" name="publicMessage" required /><Area label="Private technician note" name="privateNote" /></SaveForm><details className="mt-4"><summary className="cursor-pointer font-semibold">Inspect this repair before completion</summary><InspectionForm operations={operations} onChanged={onChanged} repair={repair} /></details></>}
    <ul className="mt-3 space-y-1 text-sm">{operations.inspections.filter((inspection) => inspection.repairJobId === repair.id).map((inspection) => <li key={inspection.id}>Inspection #{inspection.id} · {inspection.result} · {inspection.condition} · {timestamp(inspection.observedAt)}</li>)}</ul>
  </article>;
}

function Reservations({ operations }: { operations: Operations }) {
  const load = useCallback(() => request<{ bookings: ReservationData[] }>("/api/bookings?filter=all"), []);
  const query = useLiveData(load);
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState(false);
  const rows = query.data?.bookings.filter((booking) => (history || booking.status === "confirmed") && `${booking.bookingRef} ${booking.guestStudentName ?? ""} ${booking.userId ?? ""} ${booking.roomName}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <><label className="block text-sm font-semibold">Search reference, room, guest name or user ID<input className={field} value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={history} onChange={(event) => setHistory(event.target.checked)} />Include reservation history</label><button className={action} onClick={() => void query.reload()} disabled={query.loading}>Refresh reservations</button><State loading={query.loading} error={query.error} onRetry={() => void query.reload()} empty={!rows.length ? "No matching reservations." : undefined} />{!query.error && rows.map((booking) => <StaffReservation key={`${booking.id}-${booking.version}`} booking={booking} operations={operations} onChanged={() => void query.reload()} />)}</>;
}

function StaffReservation({ booking, operations, onChanged }: { booking: ReservationData; operations: Operations; onChanged: Reload }) {
  const [detail, setDetail] = useState(false);
  return <article className={card}><h2 className="text-lg font-semibold">{booking.bookingRef} · {booking.roomName} · {booking.phase}</h2><p className="mt-1 text-sm">{booking.date} · {booking.startTime}–{booking.endTime} · User #{booking.userId ?? "guest"} {booking.guestStudentName}</p>{booking.cancellationReason && <p className="mt-2 text-sm">Cancelled: {booking.cancellationReason}</p>}
    <button className={`${action} mt-3`} onClick={() => setDetail(!detail)} aria-expanded={detail}>Reservation history</button>{detail && <ReservationHistory id={booking.id} />}
    {booking.phase === "upcoming" && <details className="mt-4"><summary className="cursor-pointer font-semibold">Reschedule with reason</summary><SaveForm onChanged={onChanged} label="Reschedule reservation" onSave={(data) => request(`/api/bookings/${booking.id}/reschedule`, "PATCH", { roomId: num(data, "roomId"), date: str(data, "date"), startTime: str(data, "startTime"), endTime: str(data, "endTime"), version: booking.version, reason: str(data, "reason") })}><Select label="Room" name="roomId" value={booking.roomId} options={operations.rooms.filter((room) => room.isActive)} /><Text label="Date (institution time)" name="date" type="date" value={booking.date} required /><Text label="Start time" name="startTime" type="time" value={booking.startTime} required /><Text label="End time (00:00 = midnight)" name="endTime" type="time" value={booking.endTime} required /><Reason /></SaveForm></details>}
    {booking.status === "confirmed" && <details className="mt-4"><summary className="cursor-pointer font-semibold">Cancel reservation</summary><SaveForm onChanged={onChanged} label="Cancel reservation with reason" onSave={(data) => request(`/api/bookings/${booking.id}`, "DELETE", { version: booking.version, reason: str(data, "reason") })}><Reason /></SaveForm></details>}
  </article>;
}

function ReservationHistory({ id }: { id: number }) {
  const load = useCallback(() => request<{ history: Array<{ id: number; action: string; actorName: string | null; reason: string | null; createdAt: string }> }>(`/api/bookings/${id}/history`), [id]);
  const query = useLiveData(load);
  return <><State loading={query.loading} error={query.error} onRetry={() => void query.reload()} /><ul className="mt-3 space-y-2 text-sm">{query.data?.history.map((event) => <li key={event.id}>{event.action} · {event.actorName ?? "System"} · {event.reason ?? "No reason recorded"} · {timestamp(event.createdAt)}</li>)}</ul></>;
}

function Configuration({ admin, operations }: { admin: boolean; operations: Operations }) {
  const load = useCallback(async () => {
    const [contacts, policy, profiles] = await Promise.all([request<{ contacts: SupportContact[] }>("/api/support/contact"), request<{ policy: PublishedPolicy | null }>("/api/policies/current"), request<{ profiles: PracticeProfile[]; requirements: PracticeRequirement[] }>("/api/practice-profiles")]);
    return { ...contacts, ...policy, ...profiles };
  }, []);
  const query = useLiveData(load);
  const reload = () => void query.reload();
  return <><MovementPermissions operations={operations} /><State loading={query.loading} error={query.error} onRetry={reload} />{query.data && !query.error && <>
    <section className={card}><h2 className="text-xl font-semibold">Support contacts</h2><ul className="mt-3 space-y-2 text-sm">{query.data.contacts.map((contact) => <li key={contact.id}>{contact.name} · {contact.team} · {contact.email ?? contact.phone ?? "No direct contact"} · {contact.hours}</li>)}</ul><SaveForm label="Add support contact" onChanged={reload} reset onSave={(data) => request("/api/staff/support/contact", "POST", { name: str(data, "name"), team: str(data, "team"), email: str(data, "email"), phone: str(data, "phone"), hours: str(data, "hours") })}><Text label="Name" name="name" required /><Text label="Team" name="team" value="FTS" required /><Text label="Email" name="email" type="email" /><Text label="Phone" name="phone" type="tel" /><Text label="Support hours" name="hours" required /></SaveForm></section>
    <section className={card}><h2 className="text-xl font-semibold">Booking policy</h2><p className="mt-2 text-sm">Current: {query.data.policy?.version ?? "No published policy"}</p>{admin ? <PolicyForm key={query.data.policy?.version ?? "new"} policy={query.data.policy} onChanged={reload} /> : <p className="mt-3 text-sm">Administrators publish policy versions and edit practice requirements.</p>}</section>
    {admin && <section className={card}><h2 className="text-xl font-semibold">Practice requirements</h2>{query.data.profiles.map((profile) => <details key={profile.id} className="mt-4"><summary className="cursor-pointer font-semibold">{profile.name} · {profile.code}</summary><p className="mt-2 text-sm">Edit the full requirement list as JSON. Each entry needs requirementKey, label and a positive quantity; isHard and studentSupplied are booleans. Saving replaces this profile’s list.</p><SaveForm onChanged={reload} label="Replace profile requirements" onSave={(data) => request(`/api/staff/practice-profiles/${profile.id}/requirements`, "PUT", { requirements: JSON.parse(str(data, "requirements")) })}><label className="text-sm font-semibold sm:col-span-2">Requirements JSON<textarea className={`${field} font-mono`} name="requirements" rows={10} required defaultValue={JSON.stringify(query.data!.requirements.filter((requirement) => requirement.profileId === profile.id).map(({ requirementKey, label, equipmentType, equipmentNamePattern, quantity, isHard, studentSupplied }) => ({ requirementKey, label, equipmentType, equipmentNamePattern, quantity, isHard: Boolean(isHard), studentSupplied: Boolean(studentSupplied) })), null, 2)} /></label></SaveForm></details>)}</section>}
  </>}</>;
}

function MovementPermissions({ operations }: { operations: Operations }) {
  const load = useCallback(() => request<{ permissions: MovementPermission[] }>("/api/staff/movement-permissions"), []);
  const query = useLiveData(load);
  const [selectedId, setSelectedId] = useState("");
  const selected = query.data?.permissions.find((permission) => permission.id === Number(selectedId));
  const reload = () => void query.reload();
  return <section className={card}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Student movement permissions</h2><button className={action} disabled={query.loading} onClick={reload}>Refresh permissions</button></div>
    <p className="mt-2 text-sm">Student moves are denied unless this exact equipment and destination pair is enabled. Students also need their own active reservation, equipment present in that room, and a future return within three hours and before the session ends. Staff moves follow the normal staff workflow. Revoking permission still allows an existing movement to be returned.</p>
    <State loading={query.loading} error={query.error} onRetry={reload} empty={query.data?.permissions.length === 0 ? "No designations yet. Student moves are currently disabled for all equipment and destinations." : undefined} />
    {query.data && !query.error && <>
      <ul className="mt-3 space-y-2 text-sm">{query.data.permissions.map((permission) => <li key={permission.id} className="rounded-xl border border-violet-200 p-3 dark:border-slate-600"><p className="font-semibold">{permission.equipmentCode} · {permission.equipmentName} → {permission.toLocationName} · {permission.isActive && !permission.equipmentArchived ? "Enabled" : "Disabled"}{permission.equipmentArchived ? " (equipment archived)" : ""}</p><p>{permission.reason} · {timestamp(permission.updatedAt)}</p></li>)}</ul>
      <label className="mt-4 block text-sm font-semibold">Edit designation<select className={field} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Create or update a pair</option>{query.data.permissions.map((permission) => <option key={permission.id} value={permission.id}>{permission.equipmentCode} → {permission.toLocationName}{permission.isActive ? " (enabled)" : " (revoked)"}</option>)}</select></label>
      <SaveForm key={`${selectedId}-${selected?.updatedAt ?? "new"}`} onChanged={reload} label="Save movement permission" onSave={(data) => request("/api/staff/movement-permissions", "PUT", { equipmentId: num(data, "equipmentId"), toLocationId: num(data, "toLocationId"), isActive: data.get("isActive") === "on", reason: str(data, "reason") })}>
        <Select label="Equipment" name="equipmentId" value={selected?.equipmentId} options={operations.equipment.map((item) => ({ id: item.id, name: `${item.equipmentId} · ${item.name}${item.archived ? " (archived; revoke only)" : ""}` }))} />
        <Select label="Approved destination" name="toLocationId" value={selected?.toLocationId} options={operations.locations} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={selected?.isActive ?? false} />Allow students to move this equipment to this destination</label><Reason />
      </SaveForm>
    </>}
  </section>;
}

function PolicyForm({ policy, onChanged }: { policy: PublishedPolicy | null; onChanged: Reload }) {
  return <SaveForm label="Publish new policy version" onChanged={onChanged} onSave={(data) => request("/api/staff/policies", "POST", { version: str(data, "version"), slotMinutes: 30, minimumMinutes: num(data, "minimumMinutes"), maximumMinutes: num(data, "maximumMinutes"), advanceDays: num(data, "advanceDays"), cancellationCutoffMinutes: num(data, "cancellationCutoffMinutes"), openingTime: str(data, "openingTime"), closingTime: str(data, "closingTime"), equipmentHandling: str(data, "equipmentHandling"), movementRules: str(data, "movementRules") })}>
    <Text label="New unique version" name="version" required /><Text label="Advance booking days" name="advanceDays" type="number" min={0} max={365} value={policy?.advanceDays ?? 14} required />
    <Text label="Minimum duration (30-minute multiples)" name="minimumMinutes" type="number" min={30} value={policy?.minimumMinutes ?? 30} required /><Text label="Maximum duration (30-minute multiples)" name="maximumMinutes" type="number" min={30} value={policy?.maximumMinutes ?? 180} required />
    <Text label="Opening time" name="openingTime" type="time" value={policy?.openingTime ?? "00:00"} required /><Text label="Closing time" name="closingTime" type="time" value={policy?.closingTime ?? "00:00"} required /><Text label="Cancellation cutoff (minutes)" name="cancellationCutoffMinutes" type="number" min={0} max={10080} value={policy?.cancellationCutoffMinutes ?? 0} required />
    <Area label="Equipment handling rules" name="equipmentHandling" value={policy?.equipmentHandling} required /><Area label="Movement rules" name="movementRules" value={policy?.movementRules} required />
  </SaveForm>;
}

type Student = { id: number; fullName: string; studentId: string | null; email: string; phone: string | null };
type Audit = { id: number; action: string; entityType: string; entityId: string; reason: string | null; actorName: string | null; createdAt: string; details: string };
function Lookup() {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const loadStudents = useCallback(() => request<{ students: Student[] }>(`/api/staff/students?query=${encodeURIComponent(term)}`), [term]);
  const loadAudit = useCallback(() => request<{ events: Audit[] }>("/api/staff/audit?limit=100"), []);
  const students = useLiveData(loadStudents);
  const audit = useLiveData(loadAudit);
  return <><section className={card}><h2 className="text-xl font-semibold">Active student lookup</h2><form className="mt-4 flex items-end gap-3" onSubmit={(event) => { event.preventDefault(); if (term === search) void students.reload(); else setTerm(search); }}><label className="flex-1 text-sm font-semibold">Name, student ID or email<input className={field} value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className={primary}>Search</button></form><State loading={students.loading} error={students.error} onRetry={() => void students.reload()} empty={students.data?.students.length === 0 ? "No matching active students." : undefined} /><ul className="mt-4 space-y-3">{!students.error && students.data?.students.map((student) => <li key={student.id} className="rounded-xl border border-violet-200 p-3 text-sm dark:border-slate-600"><p className="font-semibold">{student.fullName} · User #{student.id}</p><p>{student.studentId ?? "No student ID"} · {student.email} · {student.phone ?? "No phone"}</p></li>)}</ul><p className="mt-3 text-xs">Up to 100 results. Use the user ID to filter Reservations.</p></section>
    <section className={card}><div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold">Latest audit events</h2><button className={action} onClick={() => void audit.reload()} disabled={audit.loading}>Refresh audit</button></div><State loading={audit.loading} error={audit.error} onRetry={() => void audit.reload()} empty={audit.data?.events.length === 0 ? "No audit events yet." : undefined} /><ul className="mt-4 space-y-3">{!audit.error && audit.data?.events.map((event) => <li key={event.id} className="border-l-2 border-violet-200 pl-3 text-sm"><p className="font-semibold">{event.action} · {event.entityType} #{event.entityId}</p><p>{event.actorName ?? "System"} · {timestamp(event.createdAt)}</p>{event.reason && <p>{event.reason}</p>}<details><summary className="cursor-pointer">Details</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs">{event.details}</pre></details></li>)}</ul></section>
  </>;
}
