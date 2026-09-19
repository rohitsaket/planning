// Structural checks run on an uploaded .xlsx BEFORE it reaches the spreadsheet parser.
// An .xlsx is a ZIP archive; the central directory tells us the entry count and the
// declared uncompressed size without inflating anything (archive-bomb guard).

export const WORKBOOK_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxEntries: 2000,
  maxCompressionRatio: 200,
  maxSheets: 20,
  maxRows: 20_000,
  maxColumns: 200,
};

export type GuardResult = { ok: true } | { ok: false; status: 400 | 413; message: string };

const fail = (message: string, status: 400 | 413 = 400): GuardResult => ({ ok: false, status, message });

export function inspectXlsxContainer(buffer: ArrayBuffer): GuardResult {
  const L = WORKBOOK_LIMITS;
  if (buffer.byteLength > L.maxFileBytes) return fail("File exceeds 10MB limit", 413);
  if (buffer.byteLength < 22) return fail("File is not a valid .xlsx workbook");
  const v = new DataView(buffer);
  // Local file header magic "PK\x03\x04" — content check, independent of name and MIME type.
  if (v.getUint32(0, true) !== 0x04034b50) return fail("File content is not an .xlsx (ZIP) container");

  // Locate End Of Central Directory (scan back at most 64KB + 22).
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return fail("File is not a valid .xlsx workbook");
  const entries = v.getUint16(eocd + 10, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdOffset === 0xffffffff) return fail("ZIP64 workbooks are not accepted");
  if (entries > L.maxEntries) return fail("Workbook has too many internal parts");

  const names = new Set<string>();
  let total = 0;
  let p = cdOffset;
  const dec = new TextDecoder();
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buffer.byteLength || v.getUint32(p, true) !== 0x02014b50) return fail("Workbook archive directory is corrupt");
    const compressed = v.getUint32(p + 20, true);
    const uncompressed = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    if (uncompressed === 0xffffffff) return fail("ZIP64 workbooks are not accepted");
    const name = dec.decode(new Uint8Array(buffer, p + 46, Math.min(nameLen, buffer.byteLength - p - 46)));
    names.add(name);
    total += uncompressed;
    if (total > L.maxUncompressedBytes) return fail("Workbook expands beyond the allowed size", 413);
    if (compressed > 0 && uncompressed / compressed > L.maxCompressionRatio && uncompressed > 1024 * 1024) {
      return fail("Workbook contains a suspiciously compressed part", 413);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) return fail("File is a ZIP archive but not an .xlsx workbook");
  for (const n of names) {
    if (/vbaProject\.bin$/i.test(n)) return fail("Macro-enabled workbooks are not accepted");
  }
  return { ok: true };
}

// Display/audit use only — never used for storage paths or business logic.
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").slice(0, 120) || "workbook.xlsx";
}
