const NAMES: Readonly<Record<string, string>> = { BLUE: "Blue", WHITE: "White", PINK: "Pink" };

export const packetTypeName = (value: string): string => NAMES[value] ?? value;

export const packetTypeLabel = (value: string): string => (NAMES[value] ? `${NAMES[value]} packet` : value);

export const PACKET_TYPE_DOT: Readonly<Record<string, string>> = {
  BLUE: "bg-sky-500",
  WHITE: "bg-white ring-1 ring-inset ring-zinc-400",
  PINK: "bg-pink-400",
};
