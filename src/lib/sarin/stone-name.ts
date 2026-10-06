import type { SarinPacketType } from "@/lib/sarin/domain";

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

const SEPARATOR: Record<SarinPacketType, "SPACE" | "UNDERSCORE"> = { BLUE: "SPACE", WHITE: "SPACE", PINK: "UNDERSCORE" };

export function parseSarinStoneName(name: string, packetType: SarinPacketType): StoneNameParse {
  if (name !== name.trim()) return { ok: false, code: "STONE_NAME_SURROUNDING_WHITESPACE" };

  const own = SEPARATOR[packetType];
  const m = PATTERN[own].exec(name);
  if (m) return { ok: true, kapan: m[1], packet: m[2], signer: m[3] };

  const other = own === "SPACE" ? "UNDERSCORE" : "SPACE";
  if (PATTERN[other].test(name)) return { ok: false, code: "STONE_NAME_TYPE_MISMATCH" };

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
