"use client";

import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";

// Turns the server error contract { error: { code, message, requestId } } into an Error.
export async function toApiError(res: Response): Promise<Error> {
  if (res.status === 401) useAuthStore.getState().setUser(null); // session ended → back to sign-in
  const txt = await res.text();
  try {
    const e = JSON.parse(txt)?.error;
    if (e && typeof e === "object" && e.message) return new Error(`${e.message}${e.requestId ? ` (ref ${String(e.requestId).slice(0, 8)})` : ""}`);
    if (typeof e === "string") return new Error(e);
  } catch {
    // not JSON
  }
  return new Error(`${res.status}: ${txt.slice(0, 200)}`);
}

export async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, credentials: "same-origin" });
  if (!res.ok) throw await toApiError(res);
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
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return res.json() as Promise<T>;
}
