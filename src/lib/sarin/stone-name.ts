/**
 * Sarin Stone Name identity, by the batch's declared stone type (never inferred):
 *
 *   BLUE, WHITE   Kapan-Packet Signer    e.g. 691C-117 DC, 2501-001 HA
 *   PINK          Kapan-Packet_Signer    e.g. 678-111_M
 *
 * Each component is one or more ASCII letters or digits, so the delimiters are exactly an
 * ASCII hyphen and one ASCII space (or underscore). Packet is an identifier: "001" stays
 * "001". Signer case is kept. Nothing is trimmed, repaired or guessed — a name that does
 * not match exactly is reported with the most specific reason that applies.
 *
 * Server-only.
 */

import type { SarinStoneType } from "@/lib/sarin/domain";

if (typeof window !== "undefined") {
  throw new Error("sarin/stone-name is server-only and must not be imported by client code.");
}

export type StoneNameIssueCode =
  | "STONE_NAME_SURROUNDING_WHITESPACE"
  | "STONE_NAME_TYPE_MISMATCH"
  | "STONE_NAME_KAPAN_MISSING"
  | "STONE_NAME_PACKET_MISSING"
  | "STONE_NAME_SIGNER_MISSING"
  | "STONE_NAME_INVALID";

export type StoneNameParse =
  | { readonly ok: true; readonly kapan: string; readonly packet: string; readonly signer: string }
  | { readonly ok: false; readonly code: StoneNameIssueCode };

const PATTERN = {
  SPACE: /^([A-Za-z0-9]+)-([A-Za-z0-9]+) ([A-Za-z0-9]+)$/,
  UNDERSCORE: /^([A-Za-z0-9]+)-([A-Za-z0-9]+)_([A-Za-z0-9]+)$/,
} as const;

const SEPARATOR: Record<SarinStoneType, "SPACE" | "UNDERSCORE"> = { BLUE: "SPACE", WHITE: "SPACE", PINK: "UNDERSCORE" };

export function parseSarinStoneName(name: string, stoneType: SarinStoneType): StoneNameParse {
  if (name !== name.trim()) return { ok: false, code: "STONE_NAME_SURROUNDING_WHITESPACE" };

  const own = SEPARATOR[stoneType];
  const m = PATTERN[own].exec(name);
  if (m) return { ok: true, kapan: m[1], packet: m[2], signer: m[3] };

  // A complete name of the other form is reported as such, never converted.
  const other = own === "SPACE" ? "UNDERSCORE" : "SPACE";
  if (PATTERN[other].test(name)) return { ok: false, code: "STONE_NAME_TYPE_MISMATCH" };

  // Name the missing component when the delimiters are where they should be.
  const hyphen = name.indexOf("-");
  if (hyphen === -1) return { ok: false, code: "STONE_NAME_INVALID" };
  const kapan = name.slice(0, hyphen);
  const rest = name.slice(hyphen + 1);
  const sepIndex = rest.indexOf(own === "SPACE" ? " " : "_");
  const packet = sepIndex === -1 ? rest : rest.slice(0, sepIndex);
  const signer = sepIndex === -1 ? "" : rest.slice(sepIndex + 1);
  if (kapan === "") return { ok: false, code: "STONE_NAME_KAPAN_MISSING" };
  if (packet === "") return { ok: false, code: "STONE_NAME_PACKET_MISSING" };
  if (signer === "") return { ok: false, code: "STONE_NAME_SIGNER_MISSING" };
  return { ok: false, code: "STONE_NAME_INVALID" };
}
