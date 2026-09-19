import { NextResponse } from "next/server";

export function ok<T>(data: T) {
  return NextResponse.json(data);
}

export function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function int(v: unknown): number {
  const n = num(v);
  return Math.trunc(n);
}

export function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString();
}
