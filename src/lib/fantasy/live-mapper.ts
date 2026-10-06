import { createHash } from "node:crypto";
import { z } from "zod";
import type { CanonicalEntityType, CanonicalLotStatus, CanonicalRecord, CanonicalRemovalReason } from "./canonical";
import { LIVE_LOT_FIELDS, type LiveLotFieldKey } from "./live-fields";

export const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

export function rowLookup(row: Record<string, unknown>) {
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) byKey.set(normKey(k), v);
  return (...names: string[]): unknown => {
    for (const n of names) {
      const v = byKey.get(normKey(n));
      if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) return v;
    }
    return undefined;
  };
}

const str = (v: unknown): string | null => (v === undefined || v === null ? null : String(v).trim() || null);
const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "y" || s === "yes";
};

export function parseFantasyDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const ms = /\/Date\((-?\d+)/.exec(s);
  if (ms) return new Date(Number(ms[1]));
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (dmy) {
    const d = new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1], +(dmy[4] ?? 0), +(dmy[5] ?? 0), +(dmy[6] ?? 0)));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export interface StatusResolution {
  status: CanonicalLotStatus;
  entityType: CanonicalEntityType;
  roughOrPolished: CanonicalRecord["roughOrPolished"];
  isCurrent: boolean;
  removalReason: CanonicalRemovalReason | null;
}

const WIP_STAGE: Array<[RegExp, CanonicalLotStatus]> = [
  [/laser|saw|cut/i, "WIP_LASER"],
  [/polish|facet|bruting|blocking/i, "WIP_POLISHING"],
  [/grad|cert|lab|assort/i, "WIP_GRADING"],
  [/plan|mark|sarin|galaxy/i, "WIP_PLANNING"],
];

export function resolveStatus(statusDb: string | null, processName: string | null, itemName: string | null): StatusResolution {
  const s = (statusDb ?? "").toLowerCase();
  const isRough = /rough/i.test(itemName ?? "") || /rough/i.test(processName ?? "");
  const kind: CanonicalRecord["roughOrPolished"] = isRough ? "ROUGH" : "POLISHED";
  const live = (status: CanonicalLotStatus, entityType: CanonicalEntityType, rop: CanonicalRecord["roughOrPolished"] = kind): StatusResolution => ({ status, entityType, roughOrPolished: rop, isCurrent: true, removalReason: null });
  const gone = (status: CanonicalLotStatus, entityType: CanonicalEntityType, removalReason: CanonicalRemovalReason): StatusResolution => ({ status, entityType, roughOrPolished: kind, isCurrent: false, removalReason });

  if (/sold|sale/.test(s)) return gone("SOLD", "INVOICE", "EXPLICIT_SALE");
  if (/invoice|inv\b/.test(s)) return gone("INVOICE", "INVOICE", "EXPLICIT_SALE");
  if (/memo|consign|approval/.test(s)) return live("MEMO", "MEMO");
  if (/transfer/.test(s)) return gone("TRANSFERRED", kind === "ROUGH" ? "ROUGH" : "POLISHED", "TRANSFERRED");
  if (/cancel/.test(s)) return gone("CANCELLED", kind === "ROUGH" ? "ROUGH" : "POLISHED", "CANCELLED");
  if (/archiv/.test(s)) return gone("ARCHIVED", kind === "ROUGH" ? "ROUGH" : "POLISHED", "ARCHIVED");
  if (/wip|process|manufactur|production|factory/.test(s) || (processName && !/stock|avail/.test(s))) {
    const stage = WIP_STAGE.find(([re]) => re.test(processName ?? ""))?.[1] ?? "WIP_PLANNING";
    return live(stage, "WIP", "WIP");
  }
  return live("STOCK", kind === "ROUGH" ? "ROUGH" : "POLISHED");
}

export interface MapContext {
  batchId: string;
  checkpoint: number;
  cutoff: Date;
  defaultCountry: string;
  defaultBranch: string;
}

export interface MapOutcome {
  records: CanonicalRecord[];
  skipped: Array<{ index: number; reason: string }>;
}

export function mapFantasyRow(row: Record<string, unknown>, ctx: MapContext): CanonicalRecord | { skip: string } {
  const get = rowLookup(row);
  const lotId = str(get("Lot ID", "LotID", "lotId", "Lot_Id", "LotNo", "Lot No"));
  if (!lotId) return { skip: "missing Lot ID" };

  const statusDb = str(get("Lot Status DB", "LotStatusDB", "Lot Status", "Status"));
  const processName = str(get("Process Name", "ProcessName", "Process"));
  const itemName = str(get("ItemName", "Item Name", "Item"));
  const resolved = resolveStatus(statusDb, processName, itemName);

  const weight = num(get("Weight", "Wgt", "Carat", "Cts")) ?? num(get("Original Weight", "OriginalWeight")) ?? num(get("Est. Weight", "EstWeight")) ?? num(get("Tot.Dia.Wgt", "TotDiaWgt", "Total Diamond Weight")) ?? 0;
  const shapeRaw = str(get("Shape", "ShapeName", "Est. Shape ID", "EstShapeID"));
  const shape = shapeRaw ?? (resolved.roughOrPolished === "ROUGH" ? "ROUGH" : "");
  const docDate = parseFantasyDate(get("Doc Date", "DocDate", "Date")) ?? ctx.cutoff;
  const allocationDate = parseFantasyDate(get("Allocation Date", "AllocationDate"));
  const departmentName = str(get("Department Account Name", "DepartmentAccountName", "Department", "Dept"));
  const departmentId = str(get("Department Account ID", "DepartmentAccountID", "DepartmentID", "Dept ID"));
  const companyId = str(get("Company ID", "CompanyID", "Company"));
  const country = str(get("Country")) ?? ctx.defaultCountry;
  const branch = str(get("Branch")) ?? companyId ?? ctx.defaultBranch;
  const onHold = bool(get("On Hold", "OnHold", "Hold"));
  const qty = num(get("Qty", "Quantity", "Pcs")) ?? 1;

  const known = new Set(["lotid", "lotname", "lotstatusdb", "processname", "itemname", "weight", "shape", "color", "clarity", "labname", "certificateno", "docdate", "docid", "departmentaccountname", "departmentaccountid", "companyid", "qty", "onhold", "allocationdate", "allocationaccountid", "country", "branch"]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!known.has(normKey(k)) && v !== null && v !== "" && v !== undefined) extra[k] = v;

  const rec: CanonicalRecord = {
    sourceType: "FANTASY_API",
    sourceRecordId: str(get("Doc ID", "DocID")) ?? lotId,
    lotId,
    entityType: resolved.entityType,
    currentStatus: resolved.status,
    previousStatus: null,
    statusEffectiveDate: (allocationDate ?? docDate).toISOString(),
    docDate: docDate.toISOString(),
    quantity: qty,
    shape,
    shapeNormalized: null,
    weight,
    color: str(get("Color", "Colour", "Est. Color ID", "EstColorID")),
    clarity: str(get("Clarity", "Est. Clarity ID", "EstClarityID")),
    labRaw: str(get("Lab Name", "LabName", "Lab")),
    labNormalized: null,
    certificate: str(get("Certificate No", "CertificateNo", "Cert No", "Certificate")),
    treatment: str(get("Treatment")),
    saleTotalUsd: num(get("Sale Total USD", "SaleTotalUSD", "Amount", "Sale Amount", "Total Amount")),
    customerId: str(get("Allocation Account ID", "AllocationAccountID", "Customer ID")),
    customerCode: str(get("Allocation Account ID", "AllocationAccountID", "Customer Code")),
    customerName: str(get("Allocation Account Name", "AllocationAccountName", "Customer Name", "Party Name")),
    departmentId,
    departmentName,
    locationId: null,
    locationName: str(get("Location", "LocationName")),
    country,
    branch,
    roughOrPolished: resolved.roughOrPolished,
    wipStage: resolved.entityType === "WIP" ? processName : null,
    parentRoughId: str(get("Parent Rough ID", "ParentRoughID", "Parent Lot ID")),
    kapan: str(get("Kapan")),
    stoneName: str(get("Lot Name", "LotName", "Stone Name")),
    sourceCreatedAt: docDate.toISOString(),
    sourceUpdatedAt: ctx.cutoff.toISOString(),
    firstSeenAt: docDate.toISOString(),
    lastSeenAt: ctx.cutoff.toISOString(),
    removedFromLiveAt: resolved.isCurrent ? null : docDate.toISOString(),
    removalReason: resolved.removalReason,
    isCurrent: resolved.isCurrent,
    checkpoint: ctx.checkpoint,
    syncBatchId: ctx.batchId,
    recordVersion: 1,
    isSimulated: false,
    metadata: { onHold, statusDb, processName, itemName, raw: extra },
  };
  return rec;
}

export function mapFantasyRows(rows: Record<string, unknown>[], ctx: MapContext): MapOutcome {
  const records: CanonicalRecord[] = [];
  const skipped: MapOutcome["skipped"] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const r = mapFantasyRow(row, ctx);
    if ("skip" in r) {
      skipped.push({ index, reason: r.skip });
      return;
    }
    if (seen.has(r.lotId)) {
      records.push(r);
      return;
    }
    seen.add(r.lotId);
    records.push(r);
  });
  return { records, skipped };
}

export type LiveLotValue = string | boolean | Date | null;
export type LiveLotFields = Record<LiveLotFieldKey, LiveLotValue>;

export interface MappedLiveLot {
  sourceRecordKey: string;
  contentHash: string;
  fields: LiveLotFields;
  sourcePayload: Record<string, unknown>;
  warnings: string[];
}

export interface LiveMapOutcome {
  mapped: MappedLiveLot[];
  invalid: Array<{ index: number; reason: string; identifier: string | null }>;
  unmappedSourceColumns: string[];
}

export const LiveLotRowSchema = z.record(z.string(), z.unknown());

const DECIMAL = /^-?\d+(\.\d+)?$/;

export function toDecimalString(v: unknown): { value: string | null; ok: boolean } {
  if (v === undefined || v === null || v === "") return { value: null, ok: true };
  if (typeof v === "number") return Number.isFinite(v) ? { value: String(v), ok: true } : { value: null, ok: false };
  const s = String(v).trim().replace(/,/g, "");
  if (s === "") return { value: null, ok: true };
  return DECIMAL.test(s) ? { value: s, ok: true } : { value: null, ok: false };
}

export function toBoolean(v: unknown): { value: boolean | null; ok: boolean } {
  if (v === undefined || v === null || v === "") return { value: null, ok: true };
  if (typeof v === "boolean") return { value: v, ok: true };
  if (typeof v === "number") return v === 1 ? { value: true, ok: true } : v === 0 ? { value: false, ok: true } : { value: null, ok: false };
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "y", "yes"].includes(s)) return { value: true, ok: true };
  if (["0", "false", "n", "no"].includes(s)) return { value: false, ok: true };
  return { value: null, ok: false };
}

const toText = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v).trim();
  return s === "" ? null : s;
};

export function stableRecordKey(f: Pick<LiveLotFields, "companyId" | "docId" | "lotId" | "metalId">): string | null {
  if (!f.lotId && !f.docId) return null;
  return ["v1", f.companyId ?? "", f.docId ?? "", f.lotId ?? "", f.metalId ?? ""].join("|");
}

export function contentHashOf(fields: LiveLotFields): string {
  const ordered = LIVE_LOT_FIELDS.map((s) => {
    const v = fields[s.field];
    return v instanceof Date ? v.toISOString() : v;
  });
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

function rowLookupPresence(row: Record<string, unknown>) {
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) byKey.set(normKey(k), v);
  return (...names: string[]): { present: boolean; value: unknown } => {
    for (const n of names) {
      const key = normKey(n);
      if (byKey.has(key)) return { present: true, value: byKey.get(key) };
    }
    return { present: false, value: undefined };
  };
}

export function mapLiveLot(row: Record<string, unknown>): MappedLiveLot | { invalid: string; identifier: string | null } {
  const parsed = LiveLotRowSchema.safeParse(row);
  if (!parsed.success) return { invalid: "row is not an object", identifier: null };
  const get = rowLookupPresence(row);
  const warnings: string[] = [];
  const fields = {} as LiveLotFields;
  for (const spec of LIVE_LOT_FIELDS) {
    const { present, value: raw } = get(...spec.source);
    if (!present) {
      fields[spec.field] = null;
      warnings.push(`${spec.header}: source column absent`);
      continue;
    }
    switch (spec.type) {
      case "string":
        fields[spec.field] = toText(raw);
        break;
      case "decimal": {
        const d = toDecimalString(raw);
        fields[spec.field] = d.value;
        if (!d.ok) warnings.push(`${spec.header}: non-numeric value ignored`);
        break;
      }
      case "boolean": {
        const b = toBoolean(raw);
        fields[spec.field] = b.value;
        if (!b.ok) warnings.push(`${spec.header}: unrecognised boolean ignored`);
        break;
      }
      case "date": {
        const dt = parseFantasyDate(raw);
        fields[spec.field] = dt;
        if (!dt) warnings.push(`${spec.header}: unparseable date ignored`);
        break;
      }
    }
  }
  const key = stableRecordKey(fields);
  const identifier = (fields.lotId as string | null) ?? (fields.docId as string | null) ?? null;
  if (!key) return { invalid: "no Lot ID or Doc ID: row has no stable identity", identifier };
  return { sourceRecordKey: key, contentHash: contentHashOf(fields), fields, sourcePayload: row, warnings };
}

export function mapLiveLotRows(rows: unknown[]): LiveMapOutcome {
  const mapped: MappedLiveLot[] = [];
  const invalid: LiveMapOutcome["invalid"] = [];
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      invalid.push({ index, reason: "row is not an object", identifier: null });
      return;
    }
    const r = mapLiveLot(row as Record<string, unknown>);
    if ("invalid" in r) {
      invalid.push({ index, reason: r.invalid, identifier: r.identifier });
      return;
    }
    const dup = seen.get(r.sourceRecordKey);
    if (dup !== undefined) {
      mapped[dup] = { ...r, warnings: [...r.warnings, "duplicate identity in snapshot; later row kept"] };
      return;
    }
    seen.set(r.sourceRecordKey, mapped.length);
    mapped.push(r);
  });
  const first = rows.find((r) => r && typeof r === "object" && !Array.isArray(r)) as Record<string, unknown> | undefined;
  const knownSources = new Set(LIVE_LOT_FIELDS.flatMap((s) => s.source.map(normKey)));
  const unmappedSourceColumns = first ? Object.keys(first).filter((k) => !knownSources.has(normKey(k))) : [];
  return { mapped, invalid, unmappedSourceColumns };
}

export function mappingMatrix() {
  return LIVE_LOT_FIELDS.map((s) => ({ header: s.header, field: s.field, source: s.source.join(" | "), type: s.type, nullable: true, transform: s.transform }));
}
