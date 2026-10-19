"use client";
import {useEffect,useId,useRef,useState} from "react";
import {flushSync} from "react-dom";
import {Popover} from "radix-ui";
import {Check,ChevronDown} from "lucide-react";
type Option={value:string;label:string};
export default function ReportSelect({value,onChange,options,placeholder,label,className,searchable=false}:{value:string;onChange:(value:string)=>void;options:Option[];placeholder:string;label:string;className?:string;searchable?:boolean}){
 const [open,setOpen]=useState(false),[editing,setEditing]=useState(false),[query,setQuery]=useState(""),[active,setActive]=useState(-1);
 const input=useRef<HTMLInputElement>(null),anchor=useRef<HTMLDivElement>(null),lastTap=useRef(0);const id=useId();
 const selected=options.find(o=>o.value===value);
 const matches=options.filter(o=>o.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const stepOption=(key:string)=>setActive(n=>n<0?(key==="ArrowDown"?0:matches.length-1):Math.max(0,Math.min(matches.length-1,n+(key==="ArrowDown"?1:-1))));
 const close=()=>{setOpen(false);setEditing(false);setQuery("");setActive(-1);lastTap.current=0;};
 const choose=(option:Option)=>{onChange(option.value);close();};
 const beginEditing=()=>{
  if(!searchable||editing)return;
  // The first tap targets a button, so the search input is not already focused.
  // Commit edit mode and focus the same input directly in the second click gesture.
  flushSync(()=>{setEditing(true);setQuery("");setOpen(true);});
  input.current?.focus({preventScroll:true});
  input.current?.setSelectionRange(0,0);
 };
 useEffect(()=>{setActive(-1);},[query,value]);
 useEffect(()=>{if(open&&active>=0)document.getElementById(`${id}-${active}`)?.scrollIntoView({block:"nearest"});},[active,open,id]);
 return <Popover.Root open={open} onOpenChange={next=>{if(next)setOpen(true);else close();}}><Popover.Anchor asChild><div ref={anchor} className="relative mt-2">
 <input ref={input} style={{caretColor:"#8b5cf6"}} tabIndex={editing?0:-1} role={editing?"combobox":undefined} aria-label={label} aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete={searchable?"list":"none"} aria-activedescendant={open&&matches[active]?`${id}-${active}`:undefined} aria-describedby={searchable?`${id}-hint`:undefined} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} readOnly={!editing} value={editing?query:selected?.label||""} placeholder={placeholder} className={`${className||""} !mt-0 block !pr-10 placeholder:text-slate-500 dark:placeholder:text-slate-400 ${editing?"":"cursor-pointer"}`} onClick={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onKeyDown={e=>{
  if(e.key==="Escape"){e.preventDefault();close();return;}
  if(e.key==="Tab"){close();return;}
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();setOpen(true);stepOption(e.key);return;}
  if(e.key==="Enter"){e.preventDefault();if(open&&matches[active])choose(matches[active]);else setOpen(true);return;}
  if(searchable&&!editing&&e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();setEditing(true);setQuery(e.key);setOpen(true);}
 }}/>{!editing&&<button type="button" role="combobox" aria-label={label} aria-expanded={open} aria-controls={`${id}-options`} aria-describedby={searchable?`${id}-hint`:undefined} className="absolute inset-0 w-full !rounded-xl !border-0 !bg-transparent !p-0 focus-visible:outline-2 focus-visible:outline-violet-500" onClick={()=>{const now=performance.now();if(searchable&&lastTap.current&&now-lastTap.current<450){beginEditing();lastTap.current=0;}else{lastTap.current=now;setActive(-1);setOpen(current=>!current);}}} onKeyDown={e=>{
 if(e.key==="Escape"){e.preventDefault();close();}
 else if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();if(searchable)beginEditing();else setOpen(true);stepOption(e.key);}
 else if(e.key==="Enter"&&open&&matches[active]){e.preventDefault();choose(matches[active]);}
 else if(searchable&&e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();beginEditing();setQuery(e.key);}
 }}><span className="sr-only">{selected?.label||placeholder}</span></button>}<ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" aria-hidden="true"/>
 </div></Popover.Anchor>{searchable&&<span id={`${id}-hint`} className="sr-only">Double tap or type to search options.</span>}
 <Popover.Portal><Popover.Content sideOffset={5} align="start" onOpenAutoFocus={e=>e.preventDefault()} onCloseAutoFocus={e=>e.preventDefault()} onInteractOutside={e=>{if(anchor.current?.contains(e.target as Node))e.preventDefault();}} className="z-[100] w-[var(--radix-popover-trigger-width)] min-w-[var(--radix-popover-anchor-width)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-violet-200 bg-white p-1 text-slate-900 shadow-lg dark:border-[#30384D] dark:bg-[#1B2133] dark:text-slate-100" style={{width:anchor.current?.getBoundingClientRect().width}}>
 <div id={`${id}-options`} role="listbox" aria-label={label} className="max-h-[min(20rem,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain">{matches.length?matches.map((o,i)=><div key={o.value} id={`${id}-${i}`} role="option" aria-selected={value===o.value} onPointerMove={()=>setActive(i)} onPointerDown={e=>e.preventDefault()} onClick={()=>choose(o)} className={`relative flex min-h-11 cursor-pointer items-center rounded-lg py-2 pl-3 pr-9 text-sm font-normal ${active===i||value===o.value?"bg-violet-50 text-violet-700 dark:bg-[#211A38] dark:text-violet-200":""}`}>{o.label}{value===o.value&&<Check size={16} className="absolute right-3" aria-hidden="true"/>}</div>):<p className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">No matches found.</p>}</div>
 </Popover.Content></Popover.Portal></Popover.Root>;
}
