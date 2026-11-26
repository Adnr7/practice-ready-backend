export const MAX_BOOKING_SLOTS=6;
export const ADVANCE_BOOKING_MS=60*60*1000;
export function bookingWindow(now=Date.now(),fts=false){
 if(!fts)return {start:now,end:now+ADVANCE_BOOKING_MS};
 const start=new Date(now);start.setHours(0,0,0,0);
 const end=new Date(start);end.setDate(end.getDate()+1);end.setHours(6,0,0,0);
 return {start:start.getTime(),end:end.getTime()};
}
export function bookingWindowMessage(_now=Date.now()){
 return "Book a session starting within the next hour, for up to 3 hours.";
}
export function slotWindow(date:Date,index:number){const start=new Date(date);start.setHours(0,index*30,0,0);const end=new Date(date);end.setHours(0,(index+1)*30,0,0);return {start:start.getTime(),end:end.getTime()};}
export function slotBookable(date:Date,index:number,now=Date.now()){const slot=slotWindow(date,index);return Number.isInteger(index)&&index>=0&&index<60&&slot.start>=now&&slot.end>now&&slot.start<=now+ADVANCE_BOOKING_MS;}
// Later slots may extend an eligible start; they cannot begin a new session yet.
export function slotSelectable(date:Date,index:number,selected:number[],now=Date.now()){
 if(slotBookable(date,index,now))return true;
 const first=selected[0];return Number.isInteger(index)&&index<60&&selected.length>0&&slotBookable(date,first,now)&&index>=first&&index-first<MAX_BOOKING_SLOTS;
}
export function slotOpeningLabel(date:Date,index:number){
 const opens=new Date(slotWindow(date,index).start-ADVANCE_BOOKING_MS);
 return `Opens at ${opens.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:true})}`;
}
export function bookingDateAvailable(date:Date,now=Date.now()){return Array.from({length:48},(_,i)=>i).some(i=>slotBookable(date,i,now));}
export function slotPhase(date:Date,index:number,now=Date.now()){const {start,end}=slotWindow(date,index);return end<=now?"past":start<=now?"ongoing":"future";}
export function selectedBookingWindow(date:Date,indices:number[],now=Date.now()){
 if(!indices.length||indices.length>MAX_BOOKING_SLOTS||!slotBookable(date,indices[0],now)||indices.some((i,n)=>!Number.isInteger(i)||i<0||i>=60||(n>0&&i!==indices[n-1]+1)))return null;
 const first=slotWindow(date,indices[0]);
 return {start:first.start,end:slotWindow(date,indices[indices.length-1]).end};
}

// Calendar preview only: later free slots can extend an eligible start, but
// cannot start a new booking. Keep the preview within three hours from now.
export function calendarExtensionAvailable(date:Date,index:number,now=Date.now(),occupied:{start:number;end:number}[]=[]){
 if(!Number.isInteger(index)||index<0||index>=48)return false;
 const target=slotWindow(date,index);
 if(target.end<=now||target.end>now+MAX_BOOKING_SLOTS*30*60000||slotBookable(date,index,now))return false;
 const today=new Date(now);today.setHours(0,0,0,0);
 const currentIndex=Math.floor((now-today.getTime())/(30*60000));
 for(let first=currentIndex;first<=currentIndex+2;first++){
  const start=slotWindow(today,first);
  if(!slotBookable(today,first,now)||start.start>=target.start||target.end>start.start+MAX_BOOKING_SLOTS*30*60000)continue;
  if(!occupied.some(record=>record.start<target.end&&record.end>Math.max(start.start,now)))return true;
 }
 return false;
}
