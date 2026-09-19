"use client";

import { useQuery, UseQueryOptions } from "@tanstack/react-query";

export async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export function useApi<T>(url: string | null, options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">) {
  return useQuery<T>({
    queryKey: [url],
    queryFn: () => apiFetch<T>(url as string),
    enabled: !!url,
    ...options,
  });
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}
