// One-time cleanup authorized when switching to calendar-day booking slots.
export function migrateCalendarDayStorage(){
 if(typeof window==="undefined")return;
 const marker="practice-ready-calendar-day-v1";
 if(localStorage.getItem(marker))return;
 const reservationKey="practice-ready-reservations-v1",moveKey="practice-ready-relocations-v1";
 const read=(key:string)=>{const value=JSON.parse(localStorage.getItem(key)||"[]");if(!Array.isArray(value))throw new Error("Invalid saved history");return value;};
 const reservations=read(reservationKey),moves=read(moveKey),now=Date.now();
 const retainedReservations=reservations.filter(r=>!r.cancelled&&Date.parse(r.end)>now).map(r=>{const d=new Date(r.start);return {...r,operationalDate:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};});
 const equipmentIds=new Set(moves.map(m=>m.equipmentId));
 const retainedIds=new Set<string>();
 equipmentIds.forEach(id=>{const events=moves.filter(m=>m.equipmentId===id);let index=events.length-1;while(index>=0&&events[index].eventType==="location-correction")index--;if(index>=0&&events[index].expectedReturn)events.slice(index).forEach(m=>retainedIds.add(m.id));});
 const retainedMoves=moves.filter(m=>retainedIds.has(m.id));
 const moveIds=new Set(retainedMoves.map(m=>m.id));
 const nextReservations=retainedReservations.map(r=>({...r,moveIds:(r.moveIds||[]).filter((id:string)=>moveIds.has(id))}));
 const oldReservations=localStorage.getItem(reservationKey),oldMoves=localStorage.getItem(moveKey);
 try{localStorage.setItem(reservationKey,JSON.stringify(nextReservations));localStorage.setItem(moveKey,JSON.stringify(retainedMoves));localStorage.setItem(marker,"done");}
 catch(error){if(oldReservations===null)localStorage.removeItem(reservationKey);else localStorage.setItem(reservationKey,oldReservations);if(oldMoves===null)localStorage.removeItem(moveKey);else localStorage.setItem(moveKey,oldMoves);throw error;}
}
