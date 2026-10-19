"use client";

import { useCallback, useState } from "react";
import { fetchBookingHistory, fetchBookingJournal, saveBookingJournal, type JournalData, type ReservationData, type UserProfile } from "@/lib/api-client";
import { AttachmentEditor, AttachmentGallery } from "./live-attachments";
import { action, card, field, MutationState, primary, State, timestamp, unwrap, useLiveData, useMutation } from "./live-common";

function JournalEditor({ booking, journal, user, onReload, reloading }: { booking: ReservationData; journal: JournalData | null; user: UserProfile; onReload: () => void; reloading: boolean }) {
  const [note, setNote] = useState(journal?.note ?? "");
  const [ids, setIds] = useState<number[]>(journal?.attachmentIds ?? []);
  const [savedAt, setSavedAt] = useState(journal?.updatedAt);
  const [uploading, setUploading] = useState(false);
  const mutation = useMutation();
  const editable = booking.status !== "cancelled" && user.role === "student" && booking.userId === user.id;
  return <form onSubmit={(event) => {
    event.preventDefault();
    if (!editable || uploading || reloading) return;
    void mutation.run(async () => {
      const result = await saveBookingJournal(booking.id, { note, attachmentIds: ids });
      if (result.success) { setNote(result.data.journal.note); setIds(result.data.journal.attachmentIds); setSavedAt(result.data.journal.updatedAt); }
      return result;
    }, "Journal saved to the server.");
  }}>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{savedAt ? `Last saved: ${timestamp(savedAt)}` : "No journal entry saved yet."}</p>
    {!editable && <p className="mt-2 text-sm">{booking.status === "cancelled" ? "Cancelled reservations have a read-only journal." : "Only the student who owns this reservation can edit its journal."}</p>}
    <fieldset disabled={mutation.busy || reloading} className="mt-4 grid gap-4">
      <label className="text-sm font-semibold">Practice notes<textarea className={`${field} min-h-32`} maxLength={4000} value={note} readOnly={!editable} onChange={(event) => setNote(event.target.value)} placeholder="What did you practise? What should you work on next?" /></label>
      {editable ? <AttachmentEditor ids={ids} onChange={setIds} disabled={mutation.busy || reloading} onBusyChange={setUploading} /> : <AttachmentGallery ids={ids} />}
      <div className="flex flex-wrap gap-2">{editable && <button type="submit" className={primary} disabled={mutation.busy || uploading || reloading || (!note.trim() && !ids.length)}>{mutation.busy ? "Saving…" : "Save journal"}</button>}<button type="button" className={action} disabled={mutation.busy || uploading || reloading} onClick={onReload}>Reload saved journal</button></div>
      <p className="text-xs text-slate-500 dark:text-slate-300">Reload replaces unsaved changes with the saved server entry.</p>
    </fieldset>
    <MutationState {...mutation} />
  </form>;
}

function Journal({ booking, user }: { booking: ReservationData; user: UserProfile }) {
  const load = useCallback(() => unwrap(fetchBookingJournal(booking.id)), [booking.id]);
  const query = useLiveData(load);
  const [revision, setRevision] = useState(0);
  const reload = async () => { await query.reload(); setRevision((value) => value + 1); };
  return <section className={card}><h3 className="text-lg font-semibold">Practice journal</h3><State loading={query.loading} error={query.error} onRetry={() => void reload()} />{query.data && !query.error && <JournalEditor key={revision} booking={booking} journal={query.data.journal} user={user} reloading={query.loading} onReload={() => void reload()} />}</section>;
}

export function BookingDetails({ booking, user }: { booking: ReservationData; user: UserProfile }) {
  const load = useCallback(() => unwrap(fetchBookingHistory(booking.id)), [booking]);
  const query = useLiveData(load);
  const data = query.data;
  return <div className="mt-5 grid gap-4 border-t border-slate-200 pt-5 dark:border-[#30384D]">
    <Journal booking={booking} user={user} />
    <section className={card}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">Session history & linked records</h3><button type="button" className={action} disabled={query.loading} onClick={() => void query.reload()}>Refresh records</button></div><State loading={query.loading} error={query.error} onRetry={() => void query.reload()} />{data && !query.error && <div className="mt-4 grid gap-6">
      <section><h4 className="font-semibold">Reservation timeline</h4>{!data.history.length && <State empty="No reservation changes have been recorded." />}<ul className="mt-2 space-y-3 text-sm">{data.history.map((item) => <li key={item.id}><p className="font-semibold">{item.action.replaceAll("_", " ")} · {timestamp(item.createdAt)}</p><p>{item.actorName ?? "Actor not recorded"}</p>{item.previousDate && <p>Previous: {item.previousDate} · {item.previousStartTime}–{item.previousEndTime}{item.previousRoomId ? ` · room ID ${item.previousRoomId}` : ""}</p>}{item.newDate && <p>Updated: {item.newDate} · {item.newStartTime}–{item.newEndTime}{item.newRoomId ? ` · room ID ${item.newRoomId}` : ""}</p>}{item.reason && <p>{item.reason}</p>}</li>)}</ul></section>
      <section><h4 className="font-semibold">Logged equipment use</h4>{!data.usage.length && <State empty="No equipment use logged for this session." />}<ul className="mt-2 space-y-3 text-sm">{data.usage.map((item) => <li key={item.id}><p className="font-semibold">{item.equipmentLabel} · {item.equipmentCode}</p><p>{item.observedCondition} · {item.observedStatus} · {timestamp(item.observedAt)}</p><p className="text-xs text-slate-500 dark:text-slate-300">Observed location ID: {item.observedLocationId ?? "Not recorded"}</p></li>)}</ul></section>
      <section><h4 className="font-semibold">Linked equipment movements</h4>{!data.movements.length && <State empty="No equipment movements linked to this reservation." />}<ul className="mt-2 space-y-3 text-sm">{data.movements.map((item) => <li key={item.id}><p className="font-semibold">{item.equipmentName} · {item.equipmentCode}</p><p>{item.fromLocationName} → {item.toLocationName} · {item.status}</p><p>Moved: {timestamp(item.movedAt)}</p>{item.returnedAt ? <p>Returned: {timestamp(item.returnedAt)}</p> : <p>Expected return (estimate): {timestamp(item.expectedReturnAt)}</p>}</li>)}</ul></section>
      <section><h4 className="font-semibold">Linked reports</h4>{!data.reports.length && <State empty="No reports linked to this reservation. Choose a reservation when submitting a report to link it here." />}<div className="mt-2 space-y-4">{data.reports.map((report) => <article key={report.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-600"><p className="font-semibold">{report.reference} · {report.status.replaceAll("_", " ")}</p><p className="mt-1 text-sm">{report.category} · {report.issueType ?? "Assistance"} · {timestamp(report.createdAt)}</p><p className="mt-2 whitespace-pre-wrap text-sm">{report.description}</p><AttachmentGallery ids={report.attachmentIds} /></article>)}</div></section>
    </div>}</section>
  </div>;
}
