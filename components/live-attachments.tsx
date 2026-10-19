"use client";

import { useRef, useState } from "react";
import { attachmentUrl, uploadAttachment } from "@/lib/api-client";
import { action, State } from "./live-common";

function AttachmentImage({ id }: { id: number }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <div className="min-w-0 rounded-xl border border-slate-200 p-2 dark:border-slate-600">{failed ? <div role="alert" className="text-sm"><p>Could not load image #{id}. It may be unavailable or access was denied.</p><button type="button" className={`${action} mt-2`} onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>Retry image</button></div> : <a href={attachmentUrl(id)} target="_blank" rel="noreferrer" className="block" aria-label={`Open attached image ${id}`}>
    {/* Authenticated private images must use the same-origin endpoint directly. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`${attachmentUrl(id)}?attempt=${attempt}`} alt={`Attached practice image ${id}`} loading="lazy" className="h-36 w-full rounded-lg object-contain" onError={() => setFailed(true)} />
  </a>}</div>;
}

export function AttachmentGallery({ ids }: { ids: number[] }) {
  if (!ids.length) return null;
  return <div className="mt-3 grid gap-3 sm:grid-cols-3">{ids.map((id) => <AttachmentImage key={id} id={id} />)}</div>;
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error(`Could not read ${file.name}.`));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was interrupted.`));
    reader.readAsDataURL(file);
  });
}

export function AttachmentEditor({ ids, onChange, disabled, onBusyChange }: { ids: number[]; onChange: (ids: number[]) => void; disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const upload = async (files: File[]) => {
    if (!files.length || lock.current || disabled) return;
    setError("");
    if (ids.length + files.length > 3) { setError("You can attach up to three images. Remove an image before adding more."); return; }
    lock.current = true; setBusy(true); onBusyChange(true);
    const next = [...ids];
    try {
      for (const file of files) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error(`${file.name}: choose JPEG, PNG, or WebP.`);
        if (file.size > 374_970) throw new Error(`${file.name} is too large. Choose an image smaller than about 370 KB.`);
        const result = await uploadAttachment({ fileName: file.name, mediaType: file.type, dataUrl: await readImage(file) });
        if (!result.success) throw new Error(`${file.name}: ${result.error}`);
        next.push(result.data.attachment.id);
        onChange([...next]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Image upload failed. Please retry.");
    } finally {
      lock.current = false; setBusy(false); onBusyChange(false);
    }
  };
  return <div><label className="text-sm font-semibold">Images ({ids.length}/3)<input type="file" multiple accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-violet-100 file:px-3 file:py-3 file:text-violet-800 disabled:opacity-50" disabled={disabled || busy || ids.length >= 3} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void upload(files); }} /></label><p className="mt-2 text-xs text-slate-500 dark:text-slate-300">Up to 3 JPEG, PNG, or WebP images, about 370 KB each. Uploaded images are linked when you save this form.</p>{busy && <p role="status" className="mt-2 text-sm">Uploading images…</p>}<State error={error} /><AttachmentGallery ids={ids} />{ids.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{ids.map((id, index) => <button key={id} type="button" disabled={disabled || busy} className={action} onClick={() => onChange(ids.filter((value) => value !== id))}>Remove image {index + 1}</button>)}</div>}</div>;
}
