"use client";

import { useCallback, useRef, useState } from "react";
import { fetchPracticeProfiles, fetchPublishedPolicy, fetchRoomSuitability, fetchSupportContacts, type SuitabilityData } from "@/lib/api-client";
import { action, card, field, Panel, primary, State, timestamp, unwrap, useLiveData } from "./live-common";

export function PublishedRules() {
  const load = useCallback(() => unwrap(fetchPublishedPolicy()), []);
  const query = useLiveData(load);
  const policy = query.data?.policy;
  return <section className={`${card} mt-6`}><h2 className="text-xl font-semibold">Published booking & equipment rules</h2><State loading={query.loading} error={query.error} onRetry={() => void query.reload()} empty={query.data && !policy ? "No current policy has been published. Booking limits and handling rules are unverified; check with staff before relying on them." : undefined} />{policy && !query.error && <div className="mt-3 space-y-4 text-sm"><p className="text-slate-600 dark:text-slate-300">Version {policy.version} · Published {timestamp(policy.publishedAt)}</p><dl className="grid gap-3 sm:grid-cols-2">{[["Operating hours", `${policy.openingTime}–${policy.closingTime} (campus time)`], ["Slot length", `${policy.slotMinutes} minutes`], ["Session length", `${policy.minimumMinutes}–${policy.maximumMinutes} minutes`], ["Advance booking window", `${policy.advanceDays} days`], ["Cancellation cutoff", `${policy.cancellationCutoffMinutes} minutes before the session`]].map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl><div><h3 className="font-semibold">Equipment handling</h3><p className="mt-1 whitespace-pre-wrap">{policy.equipmentHandling}</p></div><div><h3 className="font-semibold">Equipment movement rules</h3><p className="mt-1 whitespace-pre-wrap">{policy.movementRules}</p></div></div>}</section>;
}

export function SupportContacts() {
  const load = useCallback(() => unwrap(fetchSupportContacts()), []);
  const query = useLiveData(load);
  return <section className={`${card} mt-6`}><h2 className="text-xl font-semibold">Support contacts</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Published contact details. Live availability and response times are not verified.</p><State loading={query.loading} error={query.error} onRetry={() => void query.reload()} empty={query.data?.contacts.length === 0 ? "No support contacts have been published. Contact details and support hours are unverified." : undefined} />{query.data && !query.error && <div className="mt-4 grid gap-4 sm:grid-cols-2">{query.data.contacts.map((contact) => <article key={contact.id} className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-600"><h3 className="font-semibold">{contact.name}</h3><p>{contact.team}</p><p className="mt-2">Email: {contact.email ? <a className="break-all text-violet-700 underline dark:text-violet-300" href={`mailto:${contact.email}`}>{contact.email}</a> : "Not published"}</p><p>Phone: {contact.phone ? <a className="text-violet-700 underline dark:text-violet-300" href={`tel:${contact.phone}`}>{contact.phone}</a> : "Not published"}</p><p className="mt-2 whitespace-pre-wrap">Hours: {contact.hours || "Not published / unverified"}</p></article>)}</div>}</section>;
}

export function LivePractice({ onBack }: { onBack: () => void }) {
  const load = useCallback(() => unwrap(fetchPracticeProfiles()), []);
  const query = useLiveData(load);
  const [profileCode, setProfileCode] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [partySize, setPartySize] = useState(1);
  const [bringOwn, setBringOwn] = useState(false);
  const [result, setResult] = useState<SuitabilityData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const profiles = query.data?.profiles ?? [];
  const selected = profiles.find((profile) => profile.code === profileCode) ?? profiles[0];
  const requirements = query.data?.requirements.filter((item) => item.profileId === selected?.id) ?? [];
  return <Panel title="Practice Fit & Rules" onBack={onBack}><p className="mt-2 text-slate-600 dark:text-slate-300">Choose a configured practice profile and check actual room availability, capacity, restrictions, and equipment for your session.</p><section className={`${card} mt-6`}><h2 className="text-xl font-semibold">Find a suitable room</h2><State loading={query.loading} error={query.error} onRetry={() => void query.reload()} empty={query.data && !profiles.length ? "No active practice profiles are configured. Suitability recommendations are unavailable." : undefined} />{selected && !query.error && <form className="mt-4" onSubmit={async (event) => {
    event.preventDefault();
    if (lock.current) return;
    setError(""); setResult(null);
    if (endTime !== "00:00" && endTime <= startTime) { setError("End time must be after start time. Use 00:00 only to finish at midnight."); return; }
    lock.current = true; setBusy(true);
    try {
      const response = await fetchRoomSuitability({ profile: selected.code, date, startTime, endTime, partySize, bringOwnInstrument: bringOwn });
      if (!response.success) setError(response.error); else setResult(response.data);
    } finally { lock.current = false; setBusy(false); }
  }}><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold sm:col-span-2">Practice profile<select className={field} value={selected.code} onChange={(event) => setProfileCode(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.code}>{profile.name}</option>)}</select></label><div className="text-sm sm:col-span-2"><p>{selected.description || "No profile description published."}</p><h3 className="mt-3 font-semibold">Configured requirements</h3>{requirements.length ? <ul className="mt-1 list-disc space-y-1 pl-5">{requirements.map((item) => <li key={item.id}>{item.quantity} × {item.label} · {item.isHard ? "Required" : "Optional"}{item.studentSupplied ? " · May be student-supplied" : ""}</li>)}</ul> : <p className="mt-1">No equipment requirements are configured for this profile. Results do not verify equipment needs beyond this configuration.</p>}</div><label className="text-sm font-semibold">Date<input type="date" className={field} required value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="text-sm font-semibold">Number of people<input type="number" min={1} step={1} className={field} required value={partySize} onChange={(event) => setPartySize(Number(event.target.value))} /></label><label className="text-sm font-semibold">Start time<input type="time" className={field} required value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label className="text-sm font-semibold">End time<input type="time" className={field} required value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label><label className="flex items-start gap-3 text-sm sm:col-span-2"><input type="checkbox" className="mt-1 size-4" checked={bringOwn} onChange={(event) => setBringOwn(event.target.checked)} />I will bring my own instrument (only satisfies requirements configured as student-supplied).</label><p className="text-xs text-slate-500 dark:text-slate-300 sm:col-span-2">Times use campus time. 00:00 as the end time means midnight at the end of the selected date.</p><button type="submit" className={primary} disabled={busy}>{busy ? "Checking live rooms…" : "Check room suitability"}</button></fieldset></form>}<State error={error} /></section>
    {result && <section className="mt-6"><h2 className="text-xl font-semibold">Results for {result.profile.name}</h2><p className="mt-2 text-sm">{result.criteria.date} · {result.criteria.startTime}–{result.criteria.endTime} · {result.criteria.partySize} people{result.criteria.bringOwnInstrument ? " · Bringing own instrument" : ""}</p><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">These are live query results, not a reservation. Unverified and partial results need staff confirmation; availability can change before booking.</p><State empty={!result.rooms.length ? "No active rooms were returned for this query." : undefined} /><div className="mt-4 grid gap-4 sm:grid-cols-2">{result.rooms.map((item) => <article key={item.room.id} className={card}><div className="flex flex-wrap justify-between gap-2"><h3 className="text-lg font-semibold">{item.room.name}</h3><span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.suitability === "match" ? "bg-emerald-100 text-emerald-900" : item.suitability === "unavailable" ? "bg-rose-100 text-rose-900" : "bg-amber-100 text-amber-900"}`}>{{ match: "Verified match", partial: "Partial fit", unavailable: "Unavailable", unverified: "Unverified" }[item.suitability]}</span></div><p className="mt-2 text-sm">Capacity: {item.room.capacity} · {item.room.locationName ?? "Location unverified"}</p><p className="mt-1 text-sm">Readiness: {item.room.readinessState}</p><ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{item.reasons.map((reason, index) => <li key={`${reason.code}-${index}`}>{reason.message}</li>)}</ul><h4 className="mt-4 text-sm font-semibold">Matched equipment</h4>{item.matchedEquipment.length ? <ul className="mt-2 space-y-1 text-sm">{item.matchedEquipment.map((equipment) => <li key={equipment.id}>{equipment.name} · {equipment.equipmentCode} · {equipment.condition}</li>)}</ul> : <p className="mt-1 text-sm">No matched equipment reported.</p>}</article>)}</div></section>}
    <PublishedRules /><SupportContacts /><button type="button" className={`${action} mt-6`} onClick={onBack}>Return home</button>
  </Panel>;
}
