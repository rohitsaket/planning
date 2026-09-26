/**
 * Canonical country and lab registries for Sarin imports. No new registry is created:
 *
 *   Country — the organization hierarchy's Country table, by its unique code.
 *   Lab     — an active normalized lab in LabMapping, the registry the rest of the system
 *             normalizes labs through.
 *
 * The schema has no lab-to-country relationship anywhere, so a lab's membership in a
 * country cannot be checked from an authoritative source; it is not guessed from lot data.
 *
 * Server-only.
 */

import { db } from "@/lib/db";

if (typeof window !== "undefined") {
  throw new Error("sarin/registry is server-only and must not be imported by client code.");
}

type Client = Pick<typeof db, "country" | "labMapping">;

export async function isCountryRegistered(code: string, client: Client = db): Promise<boolean> {
  return (await client.country.count({ where: { code } })) > 0;
}

export async function isLabRegistered(lab: string, client: Client = db): Promise<boolean> {
  return (await client.labMapping.count({ where: { normalizedLab: lab, active: true } })) > 0;
}
