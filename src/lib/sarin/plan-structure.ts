if (typeof window !== "undefined") {
  throw new Error("sarin/plan-structure is server-only and must not be imported by client code.");
}

export const SARIN_MAIN_PLAN_LIMITS = { BLUE: 17, WHITE: 32 } as const;
export type BlueWhitePacketType = keyof typeof SARIN_MAIN_PLAN_LIMITS;

export function isBlueWhite(packetType: string): packetType is BlueWhitePacketType {
  return packetType === "BLUE" || packetType === "WHITE";
}

export const SARIN_OUTPUT_REQUIRED_FIELDS = [
  { field: "clarity", position: 5 },
  { field: "color", position: 6 },
  { field: "depthPct", position: 7 },
  { field: "ratio", position: 8 },
  { field: "length", position: 9 },
  { field: "width", position: 10 },
  { field: "depthMm", position: 11 },
] as const;

export const SARIN_VALIDATION_PROFILE_VERSION = "SARIN_VALIDATION_V3";
