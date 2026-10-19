export const MAX_BOOKING_SLOTS=6;
export function bookingWindow(now=Date.now(),fts=false){
 const start=new Date(now);start.setHours(0,0,0,0);
 const end=new Date(start);if(fts||new Date(now).getHours()>=6)end.setDate(end.getDate()+1);end.setHours(6,0,0,0);
 return {start:start.getTime(),end:end.getTime()};
}
export function bookingWindowMessage(now=Date.now()){
 return new Date(now).getHours()<6
  ? "Only today’s midnight–6:00 AM slots are open. Daytime bookings open at 6:00 AM."
  : "Booking is open until 6:00 AM tomorrow.";
}
export function slotWindow(date:Date,index:number){const start=new Date(date);start.setHours(0,index*30,0,0);const end=new Date(date);end.setHours(0,(index+1)*30,0,0);return {start:start.getTime(),end:end.getTime()};}
export function slotBookable(date:Date,index:number,now=Date.now()){const slot=slotWindow(date,index),window=bookingWindow(now);return Number.isInteger(index)&&index>=0&&index<60&&slot.end>now&&slot.start>=window.start&&slot.end<=window.end;}
export function bookingDateAvailable(date:Date,now=Date.now()){return Array.from({length:48},(_,i)=>i).some(i=>slotBookable(date,i,now));}
export function slotPhase(date:Date,index:number,now=Date.now()){const {start,end}=slotWindow(date,index);return end<=now?"past":start<=now?"ongoing":"future";}
export function selectedBookingWindow(date:Date,indices:number[],now=Date.now()){
 if(!indices.length||indices.length>MAX_BOOKING_SLOTS||indices.some((i,n)=>!slotBookable(date,i,now)||(n>0&&i!==indices[n-1]+1)))return null;
 const first=slotWindow(date,indices[0]);
 return {start:Math.max(first.start,now),end:slotWindow(date,indices[indices.length-1]).end};
}
