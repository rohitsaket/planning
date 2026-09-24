/**
 * CONFIRMED SALES — the single definition of "a sale happened".
 *
 * Extracted from the demand engine so there is exactly one answer to that question. Both
 * the demand run and the Analysis pages resolve it here; nothing re-implements the
 * window, the eligibility rule, the lifecycle deduplication or the event identity.
 *
 * What a confirmed sale is, and is not:
 *
 *   - It is a canonical `LotHistoryRecord` event whose status is SOLD or INVOICE, or
 *     whose removal reason is an explicit sale, dated inside the business window.
 *   - It is NOT a `PolishedStone` or `RoughStone` row. Those are legacy seeded mirrors:
 *     they describe stock that exists, which is the opposite of stock that sold.
 *   - It is NOT a legacy `SalesRecord`. That table is reachable only through the
 *     explicitly-requested LEGACY_SALES policy and is never unioned with canonical data,
 *     because two sources counted together would double-count every migrated sale.
 *
 * Server-only.
 */

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

/** The only two source policies. They are alternatives, never combined. */
export const SALE_SOURCE_POLICIES = ["CANONICAL_FANTASY", "LEGACY_SALES"] as const;
export type SaleSourcePolicy = (typeof SALE_SOURCE_POLICIES)[number];

/** Statuses that mark a lot as sold. */
export const SALE_STATUSES = ["SOLD", "INVOICE"] as const;
export const EXPLICIT_SALE_REMOVAL_REASON = "EXPLICIT_SALE";

/**
 * Whether a quantity can be counted as confirmed pieces.
 *
 * `EXPLICIT_FIXTURE` is provable: the fixture provider sets `quantity` on every record
 * it emits, so a fixture-sourced, simulated record's quantity was supplied rather than
 * defaulted. For anything else the column's `@default(1)` makes a stored 1
 * indistinguishable from an absent value, so the quantity is not confirmed and is
 * excluded from piece totals rather than assumed to be one.
 */
export const QUANTITY_PROVENANCES = ["EXPLICIT_FIXTURE", "UNCONFIRMED"] as const;
export type QuantityProvenance = (typeof QUANTITY_PROVENANCES)[number];

/** Fixed codes for events the service inspected and did not confirm. */
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
  /**
   * The planning-category decision in force when this sale's version was written.
   *
   * Carried from the canonical history rather than re-derived, so the demand run groups
   * the sale exactly as the synchronizer classified it. A legacy seeded sale carries no
   * canonical classification and is therefore never approved.
   */
  readonly labNormalized: string | null;
  readonly shapeNormalized: string | null;
  readonly weightBandLabel: string | null;
  readonly categoryLabState: string | null;
  readonly categoryShapeState: string | null;
  readonly categoryState: string | null;
  readonly saleTotalUsd: number | null;
  readonly customerName: string | null;
  /** Pieces. Only meaningful when `quantityProvenance` is EXPLICIT_FIXTURE. */
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
  /** Events that qualified but whose quantity could not be confirmed as pieces. */
  readonly unconfirmedQuantityEvents: number;
  /** Sum of pieces across facts with confirmed quantity provenance only. */
  readonly confirmedPieces: number;
  /** True when every contributing record is simulated. */
  readonly isSimulated: boolean;
  /** Distinct canonical source modes seen across contributing records. */
  readonly sourceModes: readonly string[];
}

export interface ConfirmedSalesOptions {
  readonly windowDays?: number;
  readonly policy?: SaleSourcePolicy;
  /** Anchor for the business window. Defaults to now; a run passes its own reference. */
  readonly referenceDate?: Date;
  readonly client?: DbClient;
}

export const DEFAULT_SALES_WINDOW_DAYS = 90;

/**
 * Computes the IST business window.
 *
 * The cutoff is an IST calendar boundary, not a rolling wall-clock offset, so two runs
 * on the same business day cover exactly the same window.
 */
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

/** True when this history row records a sale, by either of the two confirmed signals. */
export function isSaleEvent(row: { status: string; removalReason: string | null }): boolean {
  return (
    (SALE_STATUSES as readonly string[]).includes(row.status) ||
    row.removalReason === EXPLICIT_SALE_REMOVAL_REASON
  );
}

/**
 * Whether a record's quantity may be counted as confirmed pieces.
 *
 * Deliberately narrow. Widening this without a stored provenance column would mean
 * treating a column default as a business fact.
 */
export function resolveQuantityProvenance(record: {
  sourceType: string | null;
  isSimulated: boolean;
}): QuantityProvenance {
  // A *source-level* question: may this source's quantities be counted at all? The
  // per-record question — is this particular value usable — is `resolveCanonicalQuantity`,
  // which the loader below calls directly. Both read the same measurement profile, so
  // there is one rule expressed at two granularities rather than two rules.
  const profile = measurementProfileFor(record.sourceType === "FIXTURE" && record.isSimulated);
  return profile.quantitySemantics === "PIECE_COUNT" ? "EXPLICIT_FIXTURE" : "UNCONFIRMED";
}

/**
 * Loads the confirmed sales for one business window.
 *
 * Lifecycle deduplication: a lot can enter and leave a sale status repeatedly (sold,
 * returned to stock, sold again). Each contiguous run of sale statuses is one episode
 * and contributes one event; a lot that sits in SOLD across five syncs is one sale, not
 * five.
 */
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
  // Lots with at least one qualifying event inside the window. The full history of only
  // those lots is then read, because deduplication needs the episodes around the event.
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
      // No contributing record means nothing to claim about simulation either way; the
      // caller reports the source state from configuration, not from an empty set.
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
      // Recorded at ingestion. Read here so the decision uses what the source actually
      // established, rather than re-inferring it from the row's columns.
      quantityProvenance: true,
      sourceRecordId: true,
      isSimulated: true,
      // The canonical source lives on the master record, not on each history version.
      // Selected explicitly so quantity provenance is read from the record's real origin
      // rather than inferred from the history row alone.
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
      // Back to a non-sale status: the next sale starts a new episode.
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

    // Deterministic identity: the provider's own record id when it supplied one, else
    // the lot plus its episode number. Stable across runs either way.
    const eventKey = h.sourceRecordId ? `SRC_${h.sourceRecordId}` : `FANTASY_${h.lotId}_EP${state.episodeIndex}`;
    if (seenEventKeys.has(eventKey)) {
      exclusions.push({ lotId: h.lotId, version: h.version, code: "DUPLICATE_LIFECYCLE_EPISODE" });
      continue;
    }
    seenEventKeys.add(eventKey);

    const sourceType = h.lotMaster?.sourceType ?? "UNKNOWN";
    sourceModes.add(sourceType);
    if (!h.isSimulated) allSimulated = false;

    // One decision, shared with inventory and the demand calculation, so the same
    // record cannot be countable on one page and not on another.
    const decision = resolveCanonicalQuantity({
      quantity: h.quantity,
      sourceType,
      isSimulated: h.isSimulated,
      quantityProvenance: h.quantityProvenance ?? null,
    });
    const quantityProvenance: QuantityProvenance = isCountableQuantity(decision.provenance)
      ? "EXPLICIT_FIXTURE"
      : "UNCONFIRMED";
    // No `?? 1` and no `> 0 ? q : 1`. An unusable quantity stays unusable: turning it
    // into one confirmed piece is the invention this service exists to prevent.
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

/**
 * The legacy seeded sales table.
 *
 * Reachable only when a caller explicitly asks for LEGACY_SALES, and never merged with
 * canonical results. Its quantity provenance is unconfirmed by definition: these rows
 * were seeded, not synchronized.
 */
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

  // A legacy seeded row has no canonical projection to consume, so its category is
  // classified here from its own columns — by the same classifier, so an unapproved lab
  // or shape is quarantined on this path exactly as it is on the canonical one. This is
  // not the demand run reinterpreting canonical data; it is the legacy source being
  // classified for the first and only time.
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
