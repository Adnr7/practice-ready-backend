// Fixed launch date: independent of saved or deleted reservation records.
export const CALENDAR_LAUNCH_DATE="2026-09-16";
export function calendarViewRange(fts:boolean,now=Date.now()){
 const today=new Date(now);today.setHours(0,0,0,0);
 const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);
 return {min:new Date(`${CALENDAR_LAUNCH_DATE}T00:00:00`),max:fts?undefined:tomorrow};
}
export function clampCalendarDate(date:Date,min:Date,max?:Date){
 const day=new Date(date);day.setHours(0,0,0,0);
 return new Date(Math.max(min.getTime(),Math.min(day.getTime(),max?.getTime()??Infinity)));
}
