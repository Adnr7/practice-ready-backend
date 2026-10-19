"use client";
import {useId,useState,type ReactNode} from "react";
import {ChevronDown,SlidersHorizontal} from "lucide-react";
export default function AdminMobileFilters({count,children}:{count:number;children:ReactNode}){
 const [open,setOpen]=useState(false);const id=useId();
 return <div className="mb-4"><button type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)} className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-violet-300 bg-white px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 sm:hidden dark:border-violet-500/60 dark:bg-[#1B2133] dark:text-violet-200 dark:hover:bg-[#211A38]"><SlidersHorizontal size={16} aria-hidden="true"/>Filters{count>0&&<span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs dark:bg-[#211A38]">{count}<span className="sr-only"> applied</span></span>}<ChevronDown size={16} aria-hidden="true" className={`ml-auto transition ${open?"rotate-180":""}`}/></button><div id={id} className={`${open?"mt-3 block":"hidden"} rounded-xl border border-violet-200 bg-white p-4 dark:border-[#30384D] dark:bg-[#1B2133] sm:mt-0 sm:block sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 dark:sm:bg-transparent`}>{children}</div></div>;
}
