"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Client-side API access through the BFF (/bff/* → API /api/v1/*). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/bff/${path.replace(/^\//, "")}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  const json: unknown = parseJson(text);
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login?expired=1";
  }
  if (!res.ok) {
    const e = (json as { error?: { message?: string; code?: string; details?: unknown; requestId?: string } } | null)?.error;
    throw new ApiError(res.status, e?.message ?? `Erro ${res.status}`, e?.code, e?.details, e?.requestId ?? res.headers.get("x-request-id") ?? undefined);
  }
  return json as T;
}

export interface Loadable<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/** Minimal fetch hook (no cache library): refetches when `path` changes; `null` path = skip. */
export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (my !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (my !== seq.current) return;
        setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
      })
      .finally(() => {
        if (my === seq.current) setLoading(false);
      });
  }, [path, tick]);

  useEffect(() => {
    if (!opts.refreshMs || !path) return;
    const t = setInterval(() => setTick((x) => x + 1), opts.refreshMs);
    return () => clearInterval(t);
  }, [opts.refreshMs, path]);

  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, loading, reload };
}
