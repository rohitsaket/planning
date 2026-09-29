/**
 * The lab registry for Sarin imports: an active normalized lab in LabMapping, the registry
 * the rest of the system normalizes labs through. No new registry is created. Sarin
 * imports carry no country.
 *
 * Server-only.
 */

import { db } from "@/lib/db";

if (typeof window !== "undefined") {
  throw new Error("sarin/registry is server-only and must not be imported by client code.");
}

type Client = Pick<typeof db, "labMapping">;

export async function isLabRegistered(lab: string, client: Client = db): Promise<boolean> {
  return (await client.labMapping.count({ where: { normalizedLab: lab, active: true } })) > 0;
}
