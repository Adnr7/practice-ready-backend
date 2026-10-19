import type {Reservation} from "@/components/reservations";
import type {Relocation} from "@/components/equipment-relocation";
// Recompute from the latest records: never infer a physical move from a booking edit.
export function reservationMoveMismatches(reservation:Reservation,records:Relocation[],equipment:{id:string;defaultLocation?:string}[]=[]){
 const start=Date.parse(reservation.start),end=Date.parse(reservation.endedEarly?.originalEnd||reservation.end);
 return records.flatMap((move,index)=>{
  if(!move.expectedReturn||!(move.reservationId===reservation.id||reservation.moveIds?.includes(move.id)))return [];
  const nextMove=records.findIndex((r,n)=>n>index&&r.equipmentId===move.equipmentId&&!!r.expectedReturn);const later=records.slice(index+1,nextMove<0?records.length:nextMove);
  const returned=later.some(r=>r.equipmentId===move.equipmentId&&!r.expectedReturn&&(r as Relocation&{eventType?:string}).eventType!=="location-correction"&&((r as Relocation&{eventType?:string}).eventType==="return"||r.to===(equipment.find(i=>i.id===move.equipmentId)?.defaultLocation||move.from)));
  if(returned)return [];
  const latest=[...records].reverse().find(r=>r.equipmentId===move.equipmentId);
  const at=Date.parse(move.at),due=Date.parse(move.expectedReturn);const reasons:string[]=[];
  if(move.to!==reservation.room||latest?.to!==reservation.room)reasons.push("Destination does not match the reserved room.");
  if(!Number.isFinite(at)||at<start-1800000||at>=end)reasons.push("Move timing does not match the rescheduled session.");
  if(!Number.isFinite(due)||due<=start||due>end)reasons.push("Return deadline is outside the rescheduled session.");
  if(move.actorRole!=="fts"&&due-at>10800000)reasons.push("Return deadline exceeds the three-hour limit.");
  return reasons.length?[{move,reasons}]:[];
 });
}
