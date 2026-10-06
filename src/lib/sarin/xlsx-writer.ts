import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { createDeflateRaw, crc32 } from "node:zlib";

if (typeof window !== "undefined") {
  throw new Error("sarin/xlsx-writer is server-only and must not be imported by client code.");
}

const MAX_ZIP32 = 0xffffffff;

interface CentralEntry {
  name: Buffer;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export type PartWriter = (chunk: string) => Promise<void>;

export class ZipFileWriter {
  private readonly out: WriteStream;
  private offset = 0;
  private readonly entries: CentralEntry[] = [];
  private readonly stamp: { time: number; date: number };

  constructor(path: string, modified: Date) {
    this.out = createWriteStream(path, { flags: "wx", mode: 0o600 });
    this.stamp = dosDateTime(modified);
  }

  private async raw(buf: Buffer) {
    this.offset += buf.length;
    if (!this.out.write(buf)) await once(this.out, "drain");
  }

  async addEntry(path: string, produce: (write: PartWriter) => Promise<void>): Promise<void> {
    const name = Buffer.from(path, "utf8");
    const offset = this.offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0808, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(this.stamp.time, 10);
    header.writeUInt16LE(this.stamp.date, 12);
    header.writeUInt16LE(name.length, 26);
    await this.raw(Buffer.concat([header, name]));

    const deflate = createDeflateRaw({ level: 6 });
    let crc = 0;
    let size = 0;
    let compressed = 0;
    const pending: Promise<void>[] = [];
    deflate.on("data", (chunk: Buffer) => {
      compressed += chunk.length;
      this.offset += chunk.length;
      if (!this.out.write(chunk)) {
        deflate.pause();
        pending.push(once(this.out, "drain").then(() => void deflate.resume()));
      }
    });
    const ended = once(deflate, "end");
    const write: PartWriter = async (chunk) => {
      const buf = Buffer.from(chunk, "utf8");
      crc = crc32(buf, crc);
      size += buf.length;
      if (size > MAX_ZIP32) throw new Error("workbook part too large");
      if (!deflate.write(buf)) await once(deflate, "drain");
    };
    try {
      await produce(write);
    } catch (e) {
      deflate.destroy();
      throw e;
    }
    deflate.end();
    await ended;
    await Promise.all(pending);
    if (compressed > MAX_ZIP32 || this.offset > MAX_ZIP32) throw new Error("workbook too large");

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(compressed, 8);
    descriptor.writeUInt32LE(size, 12);
    await this.raw(descriptor);
    this.entries.push({ name, crc: crc >>> 0, compressed, size, offset });
  }

  async finish(): Promise<void> {
    const start = this.offset;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0808, 8);
      h.writeUInt16LE(8, 10);
      h.writeUInt16LE(this.stamp.time, 12);
      h.writeUInt16LE(this.stamp.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressed, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42);
      await this.raw(Buffer.concat([h, e.name]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    await this.raw(end);
    this.out.end();
    await once(this.out, "finish");
  }

  async abort(): Promise<void> {
    if (this.out.closed) return;
    this.out.destroy();
    await once(this.out, "close").catch(() => undefined);
  }
}

const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function xmlText(value: string): string {
  return value.replace(XML_INVALID, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const FORMULA_LIKE = /^[=+\-@\t\r]/;

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function safeSheetName(raw: string, taken: Set<string>): string {
  let base = raw.replace(XML_INVALID, "").replace(/[[\]:*?/\\]/g, "_").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Sheet";
  if (base.toLowerCase() === "history") base = "History_";
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - ` (${i})`.length)} (${i})`;
  taken.add(name.toLowerCase());
  return name;
}

export function excelDateSerial(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}
