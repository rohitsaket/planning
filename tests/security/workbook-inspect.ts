import * as XLSX from "xlsx";

export interface InspectedWorkbook {
  readonly sheetNames: string[];
  readonly parts: string[];
  part(name: string): string;
  rows(sheet: string): Array<Array<{ t: string; v: unknown; z?: string } | null>>;
  merges(sheet: string): string[];
  widths(sheet: string): number[];
  sheetXml(index: number): string;
  styleOf(index: number, ref: string): number | null;
  quotePrefixed(style: number): boolean;
  cellFills(index: number): Array<{ ref: string; col: string; row: number; fill: string | null }>;
}

export function zipEntryNames(bytes: Uint8Array): string[] {
  const buf = Buffer.from(bytes);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("bad central directory");
    const nameLen = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    names.push(buf.toString("utf8", at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extra + comment;
  }
  return names;
}

export function inspectWorkbook(bytes: Uint8Array): InspectedWorkbook {
  const zip = XLSX.CFB.read(Buffer.from(bytes), { type: "buffer" });
  const parts = zipEntryNames(bytes);
  const part = (name: string) => {
    const i = zip.FullPaths.findIndex((p) => p.replace(/^[^/]+\//, "") === name);
    return i >= 0 ? Buffer.from(zip.FileIndex[i].content as Uint8Array).toString("utf8") : "";
  };
  const wb = XLSX.read(Buffer.from(bytes), { type: "buffer", cellStyles: true, cellNF: true, cellFormula: true });
  const xfs = (part("xl/styles.xml").match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "").match(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) ?? [];
  return {
    sheetNames: wb.SheetNames,
    parts,
    part,
    rows(sheet) {
      const ws = wb.Sheets[sheet];
      const range = XLSX.utils.decode_range(ws["!ref"]!);
      const out: Array<Array<{ t: string; v: unknown; z?: string } | null>> = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: Array<{ t: string; v: unknown; z?: string } | null> = [];
        for (let c = 0; c < 19; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          row.push(cell && cell.t !== "z" ? { t: cell.t, v: cell.v, ...(cell.z && cell.z !== "General" ? { z: String(cell.z) } : {}) } : null);
        }
        out.push(row);
      }
      return out;
    },
    merges: (sheet) => (wb.Sheets[sheet]["!merges"] ?? []).map((m) => XLSX.utils.encode_range(m)).sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
    widths: (sheet) => (wb.Sheets[sheet]["!cols"] ?? []).map((c) => Number(c?.width ?? c?.wch ?? 0)),
    sheetXml: (index) => part(`xl/worksheets/sheet${index}.xml`),
    styleOf(index, ref) {
      const m = part(`xl/worksheets/sheet${index}.xml`).match(new RegExp(`<c r="${ref}" s="(\\d+)"`));
      return m ? Number(m[1]) : null;
    },
    quotePrefixed: (style) => /quotePrefix="1"/.test(xfs[style] ?? ""),
    cellFills(index) {
      const fills = (part("xl/styles.xml").match(/<fills[^>]*>([\s\S]*?)<\/fills>/)?.[1] ?? "").match(/<fill>[\s\S]*?<\/fill>/g) ?? [];
      const colour = (style: number) => {
        const fill = fills[Number(xfs[style]?.match(/fillId="(\d+)"/)?.[1] ?? 0)] ?? "";
        return /patternType="solid"/.test(fill) ? (fill.match(/fgColor rgb="FF([0-9A-F]{6})"/)?.[1] ?? null) : null;
      };
      return [...part(`xl/worksheets/sheet${index}.xml`).matchAll(/<c r="([A-Z]+)(\d+)"(?: s="(\d+)")?/g)].map((m) => ({ ref: `${m[1]}${m[2]}`, col: m[1], row: Number(m[2]), fill: colour(Number(m[3] ?? 0)) }));
    },
  };
}
