"use client";
import * as React from "react";
import {Select} from "radix-ui";
import {Check,ChevronDown,ChevronUp} from "lucide-react";

const EMPTY="__fts_empty_option__";
type Props=Omit<React.SelectHTMLAttributes<HTMLSelectElement>,"multiple"|"size"> & {placeholder?:string};
export default function AdminSelect({children,value,onChange,className,id,name,disabled,required,placeholder,...props}:Props){
 const options:React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>>[]=[];
 const collect=(nodes:React.ReactNode)=>React.Children.forEach(nodes,node=>{
  if(!React.isValidElement(node))return;
  if(node.type==="option")options.push(node as typeof options[number]);
  else if(node.type===React.Fragment)collect((node.props as {children:React.ReactNode}).children);
 });
 collect(children);
 const optionValue=(option:typeof options[number])=>String(option.props.value??option.props.children??"");
 const selected=String(value??"");
 return <Select.Root value={selected||(placeholder?"":EMPTY)} name={name} disabled={disabled} required={required} onValueChange={next=>{
  const actual=next===EMPTY?"":next;
  onChange?.({target:{value:actual},currentTarget:{value:actual}} as React.ChangeEvent<HTMLSelectElement>);
 }}>
  <Select.Trigger id={id} aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-describedby={props["aria-describedby"]} className={`flex items-center justify-between gap-2 text-left font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 ${className||""}`}>
   <Select.Value placeholder={placeholder}/><Select.Icon><ChevronDown size={16} className="shrink-0"/></Select.Icon>
  </Select.Trigger>
  <Select.Portal><Select.Content position="popper" sideOffset={5} align="start" className="z-[100] max-h-[min(20rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-violet-200 bg-white p-1 text-slate-900 shadow-lg dark:border-[#30384D] dark:bg-[#1B2133] dark:text-slate-100">
   <Select.ScrollUpButton className="flex justify-center py-1"><ChevronUp size={16}/></Select.ScrollUpButton>
   <Select.Viewport>{options.filter(option=>!placeholder||optionValue(option)!=="").map(option=><Select.Item key={optionValue(option)} value={optionValue(option)||EMPTY} disabled={option.props.disabled} className="relative flex min-h-11 cursor-default items-center rounded-lg py-2 pl-3 pr-9 text-sm font-normal outline-none data-[highlighted]:bg-violet-50 data-[highlighted]:text-violet-700 data-[disabled]:cursor-not-allowed data-[disabled]:bg-slate-50 data-[disabled]:text-slate-400 dark:data-[disabled]:bg-[#171D2D] dark:data-[disabled]:text-slate-500 dark:data-[highlighted]:bg-[#211A38] dark:data-[highlighted]:text-violet-200">
    <Select.ItemText>{option.props.children}</Select.ItemText><Select.ItemIndicator className="absolute right-3 text-violet-700 dark:text-violet-200"><Check size={16}/></Select.ItemIndicator>
   </Select.Item>)}</Select.Viewport>
   <Select.ScrollDownButton className="flex justify-center py-1"><ChevronDown size={16}/></Select.ScrollDownButton>
  </Select.Content></Select.Portal>
 </Select.Root>;
}
