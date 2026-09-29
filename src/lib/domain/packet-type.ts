/**
 * Packet type: the colour of the packet a rough stone is kept in — Blue, White or Pink.
 * Every stone handled here is a white diamond; the packet colour only categorizes and
 * separates stones. It is not a stone or diamond colour, and it is not the packet number
 * parsed from a stone name (e.g. "117" in 691C-117 DC).
 *
 * Display only. Stored values stay BLUE | WHITE | PINK. Client-safe.
 */

const NAMES: Readonly<Record<string, string>> = { BLUE: "Blue", WHITE: "White", PINK: "Pink" };

/** For a column already headed "Packet Type": Blue, White, Pink. */
export const packetTypeName = (value: string): string => NAMES[value] ?? value;

/** Where no heading says what the value is: Blue packet, White packet, Pink packet. */
export const packetTypeLabel = (value: string): string => (NAMES[value] ? `${NAMES[value]} packet` : value);

/** A subtle marker beside the packet name; the text always accompanies it. */
export const PACKET_TYPE_DOT: Readonly<Record<string, string>> = {
  BLUE: "bg-sky-500",
  WHITE: "bg-white ring-1 ring-inset ring-zinc-400",
  PINK: "bg-pink-400",
};
