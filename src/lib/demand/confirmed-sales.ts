import { db } from "@/lib/db";
import {
  isCountableQuantity,
  measurementProfileFor,
  resolveCanonicalQuantity,
} from "@/lib/fantasy/quantity-weight";
import { getISTDateString, parseISTDateToUTC } from "@/lib/fantasy/time";
import { classifyCanonicalCategory, loadCategoryClassificationContext } from "@/lib/fantasy/category-classification";
import { loadLabMappings } from "@/lib/fantasy/sync-service";

if (typeof window !== "undefined") {
  throw new Error("demand/confirmed-sales is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

export const SALE_SOURCE_POLICIES = ["CANONICAL_FANTASY", "LEGACY_SALES"] as const;
export type SaleSourcePolicy = (typeof SALE_SOURCE_POLICIES)[number];

export const SALE_STATUSES = ["SOLD", "INVOICE"] as const;
export const EXPLICIT_SALE_REMOVAL_REASON = "EXPLICIT_SALE";

export const QUANTITY_PROVENANCES = ["EXPLICIT_FIXTURE", "UNCONFIRMED"] as const;
export type QuantityProvenance = (typeof QUANTITY_PROVENANCES)[number];

export const SALE_EXCLUSION_CODES = [
  "OUTSIDE_BUSINESS_WINDOW",
  "DUPLICATE_LIFECYCLE_EPISODE",
  "QUANTITY_PROVENANCE_UNCONFIRMED",
] as const;
export type SaleExclusionCode = (typeof SALE_EXCLUSION_CODES)[number];

export interface ConfirmedSaleFact {
  readonly eventKey: string;
  readonly lotId: string;
  readonly sourceRecordId: string | null;
  readonly docDate: Date;
  readonly shape: string;
  readonly weight: number;
  readonly labRaw: string | null;
  readonly labNormalized: string | null;
  readonly shapeNormalized: string | null;
  readonly weightBandLabel: string | null;
  readonly categoryLabState: string | null;
  readonly categoryShapeState: string | null;
  readonly categoryState: string | null;
  readonly saleTotalUsd: number | null;
  readonly customerName: string | null;
  readonly quantity: number;
  readonly quantityProvenance: QuantityProvenance;
  readonly isSimulated: boolean;
  readonly sourceType: string;
}

export interface ConfirmedSaleExclusion {
  readonly lotId: string;
  readonly version: number;
  readonly code: SaleExclusionCode;
}

export interface ConfirmedSalesWindow {
  readonly windowDays: number;
  readonly businessDateIst: string;
  readonly lookbackStart: Date;
  readonly lookbackEnd: Date;
}

export interface ConfirmedSalesResult {
  readonly policy: SaleSourcePolicy;
  readonly window: ConfirmedSalesWindow;
  readonly facts: readonly ConfirmedSaleFact[];
  readonly exclusions: readonly ConfirmedSaleExclusion[];
  readonly unconfirmedQuantityEvents: number;
  readonly confirmedPieces: number;
  readonly isSimulated: boolean;
  readonly sourceModes: readonly string[];
}

export interface ConfirmedSalesOptions {
  readonly windowDays?: number;
  readonly policy?: SaleSourcePolicy;
  readonly referenceDate?: Date;
  readonly client?: DbClient;
}

export const DEFAULT_SALES_WINDOW_DAYS = 90;

export function resolveSalesWindow(windowDays: number, referenceDate: Date): ConfirmedSalesWindow {
  const businessDateIst = getISTDateString(referenceDate);
  const refDateUtc = parseISTDateToUTC(businessDateIst);
  return {
    windowDays,
    businessDateIst,
    lookbackStart: new Date(refDateUtc.getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000),
    lookbackEnd: new Date(refDateUtc.getTime() + 24 * 60 * 60 * 1000 - 1),
  };
}

export function isSaleEvent(row: { status: string; removalReason: string | null }): boolean {
  return (
    (SALE_STATUSES as readonly string[]).includes(row.status) ||
    row.removalReason === EXPLICIT_SALE_REMOVAL_REASON
  );
}

export function resolveQuantityProvenance(record: {
  sourceType: string | null;
  isSimulated: boolean;
}): QuantityProvenance {
  const profile = measurementProfileFor(record.sourceType === "FIXTURE" && record.isSimulated);
  return profile.quantitySemantics === "PIECE_COUNT" ? "EXPLICIT_FIXTURE" : "UNCONFIRMED";
}

export async function loadConfirmedSaleFacts(
  options: ConfirmedSalesOptions = {},
): Promise<ConfirmedSalesResult> {
  const client = options.client ?? db;
  const policy = options.policy ?? "CANONICAL_FANTASY";
  const windowDays = options.windowDays ?? DEFAULT_SALES_WINDOW_DAYS;
  const window = resolveSalesWindow(windowDays, options.referenceDate ?? new Date());

  return policy === "CANONICAL_FANTASY"
    ? loadCanonicalSaleFacts(window, client)
    : loadLegacySaleFacts(window, client);
}

async function loadCanonicalSaleFacts(
  window: ConfirmedSalesWindow,
  client: DbClient,
): Promise<ConfirmedSalesResult> {
  const candidateLots = await client.lotHistoryRecord.findMany({
    where: {
      docDate: { gte: window.lookbackStart, lte: window.lookbackEnd },
      OR: [
        { status: { in: [...SALE_STATUSES] } },
        { removalReason: EXPLICIT_SALE_REMOVAL_REASON },
      ],
    },
    select: { lotId: true },
    distinct: ["lotId"],
  });

  const lotIds = candidateLots.map((c) => c.lotId);
  const facts: ConfirmedSaleFact[] = [];
  const exclusions: ConfirmedSaleExclusion[] = [];

  if (lotIds.length === 0) {
    return {
      policy: "CANONICAL_FANTASY",
      window,
      facts,
      exclusions,
      unconfirmedQuantityEvents: 0,
      confirmedPieces: 0,
      isSimulated: true,
      sourceModes: [],
    };
  }

  const historyRecords = await client.lotHistoryRecord.findMany({
    where: { lotId: { in: lotIds } },
    orderBy: [{ lotId: "asc" }, { version: "asc" }],
    select: {
      lotId: true,
      version: true,
      status: true,
      removalReason: true,
      docDate: true,
      shape: true,
      weight: true,
      labRaw: true,
      labNormalized: true,
      shapeNormalized: true,
      weightBandLabel: true,
      categoryLabState: true,
      categoryShapeState: true,
      categoryState: true,
      saleTotalUsd: true,
      customerName: true,
      quantity: true,
      quantityProvenance: true,
      sourceRecordId: true,
      isSimulated: true,
      lotMaster: { select: { sourceType: true } },
    },
  });

  const seenEventKeys = new Set<string>();
  const episodeState = new Map<string, { inSaleEpisode: boolean; episodeIndex: number }>();
  const sourceModes = new Set<string>();
  let allSimulated = true;
  let unconfirmedQuantityEvents = 0;
  let confirmedPieces = 0;

  for (const h of historyRecords) {
    let state = episodeState.get(h.lotId);
    if (!state) {
      state = { inSaleEpisode: false, episodeIndex: 1 };
      episodeState.set(h.lotId, state);
    }

    if (!isSaleEvent(h)) {
      state.inSaleEpisode = false;
      state.episodeIndex++;
      continue;
    }

    if (state.inSaleEpisode) {
      exclusions.push({ lotId: h.lotId, version: h.version, code: "DUPLICATE_LIFECYCLE_EPISODE" });
      continue;
    }
    state.inSaleEpisode = true;

    if (h.docDate < window.lookbackStart || h.docDate > window.lookbackEnd) {
      exclusions.push({ lotId: h.lotId, version: h.version, code: "OUTSIDE_BUSINESS_WINDOW" });
      continue;
    }

    const eventKey = h.sourceRecordId ? `SRC_${h.sourceRecordId}` : `FANTASY_${h.lotId}_EP${state.episodeIndex}`;
    if (seenEventKeys.has(eventKey)) {
      exclusions.push({ lotId: h.lotId, version: h.version, code: "DUPLICATE_LIFECYCLE_EPISODE" });
      continue;
    }
    seenEventKeys.add(eventKey);

    const sourceType = h.lotMaster?.sourceType ?? "UNKNOWN";
    sourceModes.add(sourceType);
    if (!h.isSimulated) allSimulated = false;

    const decision = resolveCanonicalQuantity({
      quantity: h.quantity,
      sourceType,
      isSimulated: h.isSimulated,
      quantityProvenance: h.quantityProvenance ?? null,
    });
    const quantityProvenance: QuantityProvenance = isCountableQuantity(decision.provenance)
      ? "EXPLICIT_FIXTURE"
      : "UNCONFIRMED";
    const quantity = decision.pieces ?? 0;

    if (quantityProvenance === "EXPLICIT_FIXTURE" && quantity > 0) {
      confirmedPieces += quantity;
    } else {
      unconfirmedQuantityEvents++;
      exclusions.push({ lotId: h.lotId, version: h.version, code: "QUANTITY_PROVENANCE_UNCONFIRMED" });
    }

    facts.push({
      eventKey,
      lotId: h.lotId,
      sourceRecordId: h.sourceRecordId,
      docDate: h.docDate,
      shape: h.shape,
      weight: Number(h.weight),
      labRaw: h.labRaw,
      labNormalized: h.labNormalized,
      shapeNormalized: h.shapeNormalized,
      weightBandLabel: h.weightBandLabel,
      categoryLabState: h.categoryLabState,
      categoryShapeState: h.categoryShapeState,
      categoryState: h.categoryState,
      saleTotalUsd: h.saleTotalUsd === null ? null : Number(h.saleTotalUsd),
      customerName: h.customerName,
      quantity,
      quantityProvenance,
      isSimulated: h.isSimulated,
      sourceType,
    });
  }

  return {
    policy: "CANONICAL_FANTASY",
    window,
    facts,
    exclusions,
    unconfirmedQuantityEvents,
    confirmedPieces,
    isSimulated: allSimulated,
    sourceModes: [...sourceModes].sort(),
  };
}

async function loadLegacySaleFacts(
  window: ConfirmedSalesWindow,
  client: DbClient,
): Promise<ConfirmedSalesResult> {
  const rows = await client.salesRecord.findMany({
    where: { docDate: { gte: window.lookbackStart, lte: window.lookbackEnd } },
    select: {
      id: true,
      lotId: true,
      docDate: true,
      shape: true,
      weight: true,
      labRaw: true,
      labNormalized: true,
      saleTotalUsd: true,
      qty: true,
    },
  });

  const facts: ConfirmedSaleFact[] = [];
  const exclusions: ConfirmedSaleExclusion[] = [];
  const seen = new Set<string>();

  const legacyContext = await loadCategoryClassificationContext(client, await loadLabMappings(client));

  for (const s of rows) {
    const eventKey = `LEGACY_${s.lotId}_${s.id}`;
    if (seen.has(eventKey)) continue;
    seen.add(eventKey);

    const rawQuantity = Number(s.qty);
    const legacyCategory = classifyCanonicalCategory(
      { labRaw: s.labRaw ?? s.labNormalized, shapeRaw: s.shape, weightCt: Number(s.weight) },
      legacyContext,
    );
    facts.push({
      eventKey,
      lotId: s.lotId,
      sourceRecordId: null,
      docDate: s.docDate,
      shape: s.shape,
      weight: Number(s.weight),
      labRaw: s.labRaw,
      labNormalized: legacyCategory.labNormalized,
      shapeNormalized: legacyCategory.shapeNormalized,
      weightBandLabel: legacyCategory.weightBandLabel,
      categoryLabState: legacyCategory.labState,
      categoryShapeState: legacyCategory.shapeState,
      categoryState: legacyCategory.state,
      saleTotalUsd: s.saleTotalUsd === null ? null : Number(s.saleTotalUsd),
      customerName: null,
      quantity: Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 0,
      quantityProvenance: "UNCONFIRMED",
      isSimulated: true,
      sourceType: "LEGACY_SEED",
    });
    exclusions.push({ lotId: s.lotId, version: 0, code: "QUANTITY_PROVENANCE_UNCONFIRMED" });
  }

  return {
    policy: "LEGACY_SALES",
    window,
    facts,
    exclusions,
    unconfirmedQuantityEvents: facts.length,
    confirmedPieces: 0,
    isSimulated: true,
    sourceModes: ["LEGACY_SEED"],
  };
}
