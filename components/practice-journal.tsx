"use client";
import { useEffect, useRef, useState } from "react";
import { preparePhoto, MAX_PHOTO_BYTES } from "@/lib/photo-upload";
import { ImagePlus, X } from "lucide-react";
import type { Reservation } from "@/components/reservations";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Entry = { note: string; photos: string[]; updatedAt: string };
const eventName = "practice-ready-open-journal";
function storageKey(id: string) {
 let scope = "sample";
 try { scope = JSON.parse(localStorage.getItem("practice-ready-demo-credential-v1") || "null")?.salt || scope; } catch {}
 return `practice-ready-journal-v1:${scope}:${id}`;
}
export function loadJournal(id: string): Entry | null {
 try { const value = JSON.parse(localStorage.getItem(storageKey(id)) || "null"); return value && typeof value.note === "string" && Array.isArray(value.photos) ? value : id === "SAMPLE-COMPLETED" ? {note:"Practised vocal warm-ups, breath support and the chorus of my performance piece.\n\nThe higher phrases felt more comfortable after slowing them down. I still need to keep my breath steady through the final line.\n\nNext session: practise the chorus transitions and record a full take.",photos:[],updatedAt:""} : null; } catch { return null; }
}
export function openJournal(reservation: Reservation) { window.dispatchEvent(new CustomEvent(eventName, { detail: reservation })); }
const action = "min-h-11 rounded-xl border border-violet-300 px-4 py-2 font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-500/70 dark:text-violet-200 dark:hover:bg-[#211A38]";
export default function PracticeJournal({getReservations}: {getReservations:()=>Reservation[]}) {
 const [session,setSession] = useState<Reservation|null>(null), [prompt,setPrompt] = useState<Reservation|null>(null);
 const [note,setNote] = useState(""), [photos,setPhotos] = useState<string[]>([]), [error,setError] = useState(""), [uploading,setUploading] = useState(false);
 const fileInput=useRef<HTMLInputElement>(null);
 const active = useRef(new Map<string,Reservation>());
 function edit(r:Reservation) {
  if (r.cancelled || Date.parse(r.end)>Date.now()) return;
  const entry=loadJournal(r.id);setNote(entry?.note || "");setPhotos(entry?.photos || []);setError("");setPrompt(null);setSession(r);
 }
 useEffect(()=>{
  const open=(event:Event)=>edit((event as CustomEvent<Reservation>).detail);
  window.addEventListener(eventName,open);
  function check() {
   const now=Date.now(), items=getReservations();
   for(const r of items) {
    if(!r.cancelled && Date.parse(r.end)<=now && active.current.has(r.id) && !loadJournal(r.id)) setPrompt(r);
   }
   active.current=new Map(items.filter(r=>!r.cancelled&&Date.parse(r.start)<=now&&Date.parse(r.end)>now).map(r=>[r.id,r]));
  }
  check();const timer=setInterval(check,15000);
  return()=>{clearInterval(timer);window.removeEventListener(eventName,open);};
 },[getReservations]);
 async function addPhotos(files:FileList|null) {
  if(!files?.length)return;setError("");
  if(photos.length+files.length>3){setError("You can add up to 3 photos.");return;}
  const selected=Array.from(files);
  if(selected.some(f=>!["image/jpeg","image/png","image/webp"].includes(f.type)||f.size>MAX_PHOTO_BYTES)){setError("Choose JPG, PNG or WebP photos up to 10 MB each.");return;}
  setUploading(true);
  try {const added=await Promise.all(selected.map(preparePhoto));setPhotos(previous=>[...previous,...added]);}catch(e){setError(e instanceof Error?e.message:"Could not read the photo. Please try again.");}finally{setUploading(false);}
 }
 return <><Dialog open={!!prompt} onOpenChange={open=>{if(!open)setPrompt(null);}}><DialogContent className="rounded-3xl bg-white dark:bg-[#1B2133]"><DialogHeader><DialogTitle>Your session has ended</DialogTitle><DialogDescription>Add a practice note for {prompt?.room} while it’s fresh in your mind.</DialogDescription></DialogHeader><div className="flex flex-wrap justify-between gap-3"><button className={action} onClick={()=>setPrompt(null)}>Maybe later</button><button className={action} onClick={()=>prompt&&edit(prompt)}>Add note</button></div></DialogContent></Dialog>
 <Dialog open={!!session} onOpenChange={open=>{if(!open&&!uploading)setSession(null);}}><DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl bg-white text-slate-900 dark:bg-[#1B2133] dark:text-white"><DialogHeader><DialogTitle>Practice journal</DialogTitle><DialogDescription>{session?.room} · {session&&new Date(session.start).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})} · {session?.time}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={e=>{e.preventDefault();if(!session)return;if(!note.trim()&&!photos.length){setError("Add a note or a photo before saving.");return;}try{localStorage.setItem(storageKey(session.id),JSON.stringify({note:note.trim(),photos,updatedAt:new Date().toISOString()}));window.dispatchEvent(new Event("practice-ready-journal-saved"));setSession(null);}catch{setError("Could not save. Device storage may be full; try removing a photo.");}}}>
 <label htmlFor="practice-note" className="block text-sm font-semibold">Your practice note<textarea id="practice-note" rows={6} maxLength={4000} value={note} onChange={e=>{setNote(e.target.value);setError("");}} placeholder="What did you practise? How did it go? What would you like to work on next?" className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-base outline-none focus:border-violet-500 dark:border-slate-600 dark:bg-[#111733]"/></label>
 <div><input ref={fileInput} id="practice-photos" aria-label="Upload practice photos" className="hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading||photos.length>=3} onChange={e=>{void addPhotos(e.target.files);e.target.value="";}}/><button type="button" disabled={uploading||photos.length>=3} onClick={()=>fileInput.current?.click()} className={`${action} inline-flex items-center gap-2 transition disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-violet-500`}><ImagePlus size={20} aria-hidden="true"/>{uploading?"Adding photos…":"Add photos"}</button><p className="mt-2 text-xs text-slate-500 dark:text-slate-300">Optional · Up to 3 photos · 10 MB each</p></div>
 {photos.length>0&&<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((photo,index)=><div key={index} className="relative"><img src={photo} alt={`Practice photo ${index+1}`} className="h-28 w-full rounded-xl object-cover"/><button type="button" aria-label={`Remove photo ${index+1}`} className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-full bg-slate-900/80 text-white hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-violet-400" onClick={()=>setPhotos(photos.filter((_,i)=>i!==index))}><X size={16} aria-hidden="true"/></button></div>)}</div>}
 {error&&<p role="alert" className="text-sm text-red-600 dark:text-red-300">{error}</p>}
 <div className="flex justify-between gap-3"><button type="button" disabled={uploading} className={action} onClick={()=>setSession(null)}>Close</button><button disabled={uploading} type="submit" className="min-h-11 rounded-xl bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-700 disabled:opacity-60">{uploading?"Adding photos…":"Save entry"}</button></div></form></DialogContent></Dialog></>;
}
