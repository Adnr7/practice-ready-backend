"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiResult } from "@/lib/api-client";

export const card = "rounded-3xl border border-violet-200 bg-white p-5 dark:border-[#30384D] dark:bg-[#1B2133]";
export const field = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-[#171D2D] dark:text-white";
export const action = "min-h-11 rounded-xl border border-violet-300 px-4 py-2 font-semibold text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-500/70 dark:text-violet-200 dark:hover:bg-[#211A38]";
export const primary = "min-h-11 rounded-xl bg-violet-600 px-4 py-2 font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50";

export function Panel({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return <main className="min-h-screen bg-[#f7f8fc] px-4 py-5 text-[#151a31] dark:bg-[#171D2D] dark:text-[#F5F7FF] sm:px-8 sm:py-8"><div className="mx-auto max-w-4xl"><button type="button" className="mb-5 min-h-10 text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300" onClick={onBack}>← Home</button><h1 className="text-3xl font-semibold tracking-tight">{title}</h1>{children}</div></main>;
}

export function State({ loading = false, error = "", empty, onRetry }: { loading?: boolean; error?: string; empty?: string; onRetry?: () => void }) {
  if (loading) return <p role="status" className="mt-4 text-sm text-slate-500 dark:text-slate-300">Loading live data…</p>;
  if (error) return <div role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200"><p>{error}</p>{onRetry && <button type="button" className={`${action} mt-3`} onClick={onRetry}>Retry loading</button>}</div>;
  if (empty) return <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-600 dark:text-slate-300">{empty}</p>;
  return null;
}

export async function required<T>(request: Promise<T | null>, label: string): Promise<T> {
  const value = await request;
  if (value === null) throw new Error(`Could not load ${label}. Please retry.`);
  return value;
}

export async function unwrap<T>(request: Promise<ApiResult<T>>): Promise<T> {
  const result = await request;
  if (!result.success) throw new Error(result.error);
  return result.data;
}

/** Ignore late responses after navigating away or starting a newer refresh. */
export function useLiveData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  const invalidate = useCallback(() => { request.current++; }, []);
  const reload = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError("");
    try {
      const next = await load();
      if (id === request.current) setData(next);
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error ? cause.message : "Could not load live data.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => { window.clearTimeout(timer); invalidate(); };
  }, [reload, invalidate]);
  return { data, loading, error, reload };
}

export function useMutation() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const run = async (operation: () => Promise<{ success: boolean; error?: string }>, message: string, after?: () => void) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice(""); setError("");
    try {
      const result = await operation();
      if (!result.success) { setError(result.error ?? "The server did not confirm this change. Please retry."); return; }
      setNotice(message); after?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this change. Please retry.");
    } finally {
      lock.current = false; setBusy(false);
    }
  };
  return { busy, notice, error, run };
}

export function MutationState({ notice, error }: { notice: string; error: string }) {
  return <>{error && <State error={error} />}{notice && <p role="status" className="mt-3 rounded-xl bg-violet-50 p-3 text-sm text-violet-800 dark:bg-[#211A38] dark:text-violet-100">{notice}</p>}</>;
}

export function timestamp(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
