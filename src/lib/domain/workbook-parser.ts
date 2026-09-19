// ============================================================================
// WORKBOOK PARSER — Implements the confirmed workbook contract (spec §31-40)
// - Reads first worksheet
// - Detects/skips legacy header row
// - Interprets only first 11 physical columns
// - Preserves source order (NEVER sort)
// - Parses Blue/White stone names (spec §32-33)
// - Applies shape normalization (spec §40)
// - Validates EMERALD 5STEP ratio (spec §41)
// - Computes yield, groups additional plans (spec §36-38)
// - Identifies top-3 yields (spec §43)
// ============================================================================

import * as XLSX from "xlsx";
import {
  parseStoneName, normalizeShape, resolveEmerald5Step, calculatePlanYield,
  formatEstWeight, type ParsedStoneName,
} from "@/lib/domain/diamond-rules";
import { WORKBOOK_LIMITS } from "@/lib/domain/workbook-guard";

export interface WorkbookRow {
  rowIndex: number; // 1-based source order
  stoneName: string;
  parsed: ParsedStoneName;
  roughCut: string;
  shapeRaw: string;
  shapeNormalized: string;
  shapeKnown: boolean;
  polishWeight: number;
  clarity: string;
  color: string;
  totalDepthPct: number | null;
  ratio: number | null;
  length: number | null;
  width: number | null;
  totalDepthMm: number | null;
  // Computed
  yieldPct: number;
  emeraldIssue?: string;
  extraColumns: number; // columns after 11 (warn)
}

export interface PlanGroup {
  groupIndex: number;
  planNumber: number; // within stone name block
  isAdditional: boolean; // beyond main plan limit
  isMainPlan: boolean;
  rows: WorkbookRow[];
  combinedYieldPct: number;
  topRank: number | null; // 1, 2, or 3 for top-3 yield among main+additional groups
}

export interface StoneNameBlock {
  stoneName: string;
  parsed: ParsedStoneName;
  roughWeight: number;
  rows: WorkbookRow[];
  planGroups: PlanGroup[];
  blueMainLimit: number; // 17
  whiteMainLimit: number; // 32
  validationWarnings: string[];
}

export interface WorkbookParseResult {
  totalRows: number;
  blocks: StoneNameBlock[];
  validationIssues: Array<{ severity: "INFO" | "WARNING" | "ERROR" | "BLOCKING"; row: number; message: string }>;
  stoneNameCount: number;
  unknownShapes: string[];
  topThreeYields: Array<{ stoneName: string; planNumber: number; yieldPct: number; rank: number }>;
  legacyHeaderDetected: boolean;
  extraColumnsCount: number;
  parseErrors: string[];
}

// Confirmed main plan limits (spec §36)
const BLUE_MAIN_PLAN_LIMIT = 17;
const WHITE_MAIN_PLAN_LIMIT = 32;

export function parseWorkbook(buffer: ArrayBuffer): WorkbookParseResult {
  const result: WorkbookParseResult = {
    totalRows: 0,
    blocks: [],
    validationIssues: [],
    stoneNameCount: 0,
    unknownShapes: [],
    topThreeYields: [],
    legacyHeaderDetected: false,
    extraColumnsCount: 0,
    parseErrors: [],
  };

  let workbook: XLSX.WorkBook;
  try {
    // Bounded, data-only read: no formulas, HTML, macros or styles; rows capped.
    workbook = XLSX.read(buffer, {
      type: "array",
      sheetRows: WORKBOOK_LIMITS.maxRows + 1,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      bookFiles: false,
    });
  } catch {
    result.parseErrors.push("Failed to read XLSX: the file is corrupt or not a supported workbook");
    return result;
  }

  if (workbook.SheetNames.length > WORKBOOK_LIMITS.maxSheets) {
    result.parseErrors.push(`Workbook has more than ${WORKBOOK_LIMITS.maxSheets} sheets`);
    return result;
  }

  if (workbook.SheetNames.length === 0) {
    result.parseErrors.push("Workbook has no sheets");
    return result;
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const fullRef = (sheet["!fullref"] as string | undefined) ?? sheet["!ref"];
  if (fullRef) {
    const range = XLSX.utils.decode_range(fullRef);
    if (range.e.r + 1 > WORKBOOK_LIMITS.maxRows) {
      result.parseErrors.push(`First sheet has more than ${WORKBOOK_LIMITS.maxRows} rows`);
      return result;
    }
    if (range.e.c + 1 > WORKBOOK_LIMITS.maxColumns) {
      result.parseErrors.push(`First sheet has more than ${WORKBOOK_LIMITS.maxColumns} columns`);
      return result;
    }
  }
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });

  if (rows.length === 0) {
    result.parseErrors.push("First sheet is empty");
    return result;
  }

  // Detect legacy header row (spec §31: "A legacy header can be detected/skipped")
  let startRow = 0;
  const firstRow = rows[0];
  if (firstRow && typeof firstRow[0] === "string") {
    const cell0 = String(firstRow[0]).toLowerCase().trim();
    if (
      cell0.includes("stone") || cell0.includes("name") ||
      cell0.includes("kapan") || cell0.includes("no")
    ) {
      // Check if row 1 (0-indexed) has numeric/structured data — if row 0 looks like a header
      const row1 = rows[1];
      if (row1 && typeof row1[0] === "string" && /\d/.test(String(row1[0]))) {
        startRow = 1;
        result.legacyHeaderDetected = true;
      }
    }
  }

  // Count extra columns (spec §31: "Columns after 11: ignore for calculation but report warning")
  const maxCols = Math.max(...rows.slice(startRow).map((r) => r.length));
  if (maxCols > 11) {
    result.extraColumnsCount = maxCols - 11;
    result.validationIssues.push({
      severity: "WARNING",
      row: 0,
      message: `Detected ${maxCols - 11} extra column(s) after the first 11 — ignored per workbook contract`,
    });
  }

  // Parse rows — preserve source order (spec §34: "Never sort or reorder planning rows")
  const workbookRows: WorkbookRow[] = [];
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const stoneName = String(row[0] ?? "").trim();
    if (!stoneName) continue;

    const parsed = parseStoneName(stoneName);
    const shapeRaw = String(row[2] ?? "").trim();
    const shapeN = normalizeShape(shapeRaw);

    const polishWeight = parseFloat(String(row[3] ?? "0")) || 0;
    const roughCut = String(row[1] ?? "").trim();
    const clarity = String(row[4] ?? "").trim();
    const color = String(row[5] ?? "").trim();
    const totalDepthPct = parseFloat(String(row[6] ?? "")) || null;
    const ratio = parseFloat(String(row[7] ?? "")) || null;
    const length = parseFloat(String(row[8] ?? "")) || null;
    const width = parseFloat(String(row[9] ?? "")) || null;
    const totalDepthMm = parseFloat(String(row[10] ?? "")) || null;

    // Validate EMERALD 5STEP (spec §41)
    let emeraldIssue: string | undefined;
    if (shapeRaw.toUpperCase().includes("EMERALD 5STEP")) {
      const resolved = resolveEmerald5Step(ratio);
      if (!resolved.valid) emeraldIssue = resolved.issue;
    }

    // Track unknown shapes
    if (!shapeN.known && shapeRaw) {
      if (!result.unknownShapes.includes(shapeRaw)) {
        result.unknownShapes.push(shapeRaw);
      }
    }

    workbookRows.push({
      rowIndex: i - startRow + 1,
      stoneName,
      parsed,
      roughCut,
      shapeRaw,
      shapeNormalized: shapeN.normalized,
      shapeKnown: shapeN.known,
      polishWeight,
      clarity,
      color,
      totalDepthPct,
      ratio,
      length,
      width,
      totalDepthMm,
      yieldPct: 0, // computed later once we know roughWeight
      emeraldIssue,
      extraColumns: Math.max(0, row.length - 11),
    });
  }

  result.totalRows = workbookRows.length;

  // Group by stone name — blocks retain order of first appearance (spec §34)
  const blockMap = new Map<string, WorkbookRow[]>();
  const blockOrder: string[] = [];
  for (const row of workbookRows) {
    if (!blockMap.has(row.stoneName)) {
      blockMap.set(row.stoneName, []);
      blockOrder.push(row.stoneName);
    }
    blockMap.get(row.stoneName)!.push(row);
  }
  result.stoneNameCount = blockOrder.length;

  // Build blocks with plan groups
  for (const stoneName of blockOrder) {
    const rows = blockMap.get(stoneName)!;
    const parsed = rows[0].parsed;
    const stoneType = parsed.stoneType;
    const mainLimit = stoneType === "BLUE" ? BLUE_MAIN_PLAN_LIMIT : WHITE_MAIN_PLAN_LIMIT;

    // Rough weight must be consistent within block (spec §33)
    const roughWeights = new Set(rows.map((r) => r.roughCut));
    let roughWeight = 0;
    const rwParsed = [...roughWeights].map((x) => parseFloat(x)).filter((x) => !isNaN(x) && x > 0);
    if (rwParsed.length > 0) roughWeight = rwParsed[0];
    const validationWarnings: string[] = [];
    if (roughWeights.size > 1) {
      validationWarnings.push(`Rough weight inconsistent within block: ${[...roughWeights].join(", ")}`);
      result.validationIssues.push({
        severity: "BLOCKING",
        row: rows[0].rowIndex,
        message: `Rough weight mismatch in stone block "${stoneName}"`,
      });
    }

    // Assign yield per row (spec §36: Yield = Est. Weight / Rough Weight)
    for (const row of rows) {
      row.yieldPct = calculatePlanYield(row.polishWeight, roughWeight);
    }

    // Build plan groups (spec §36-38)
    const planGroups: PlanGroup[] = [];
    let currentGroup: WorkbookRow[] = [];
    let prevWeight2dec = -1;
    let groupStartIdx = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const planNumber = i + 1;
      const isMainPlan = planNumber <= mainLimit;
      const isAdditional = !isMainPlan;

      if (isMainPlan) {
        // Each main plan row is its own group
        planGroups.push({
          groupIndex: planGroups.length,
          planNumber,
          isAdditional: false,
          isMainPlan: true,
          rows: [row],
          combinedYieldPct: row.yieldPct,
          topRank: null,
        });
      } else {
        // Additional rows: group by weight comparison (spec §37)
        const curWeight2dec = Math.round(row.polishWeight * 100) / 100;
        if (prevWeight2dec === -1) {
          // Start new group
          currentGroup = [row];
          groupStartIdx = i;
          prevWeight2dec = curWeight2dec;
        } else if (curWeight2dec <= prevWeight2dec) {
          // Same group
          currentGroup.push(row);
          prevWeight2dec = curWeight2dec;
        } else {
          // New group — finalize previous
          if (currentGroup.length > 0) {
            const totalEst = currentGroup.reduce((s, r) => s + r.polishWeight, 0);
            planGroups.push({
              groupIndex: planGroups.length,
              planNumber: groupStartIdx + 1,
              isAdditional: true,
              isMainPlan: false,
              rows: currentGroup,
              combinedYieldPct: calculatePlanYield(totalEst, roughWeight),
              topRank: null,
            });
          }
          currentGroup = [row];
          groupStartIdx = i;
          prevWeight2dec = curWeight2dec;
        }
      }
    }
    // Finalize last additional group if exists
    if (currentGroup.length > 0) {
      const totalEst = currentGroup.reduce((s, r) => s + r.polishWeight, 0);
      planGroups.push({
        groupIndex: planGroups.length,
        planNumber: groupStartIdx + 1,
        isAdditional: true,
        isMainPlan: false,
        rows: currentGroup,
        combinedYieldPct: calculatePlanYield(totalEst, roughWeight),
        topRank: null,
      });
    }

    // Top-3 yield ranking (spec §43): compare all main plan yields + additional group combined yields
    const yieldCandidates = planGroups.map((g) => ({
      groupIndex: g.groupIndex,
      yieldPct: g.combinedYieldPct,
    }));
    yieldCandidates.sort((a, b) => b.yieldPct - a.yieldPct);
    for (let rank = 0; rank < Math.min(3, yieldCandidates.length); rank++) {
      const gi = yieldCandidates[rank].groupIndex;
      planGroups[gi].topRank = rank + 1;
      result.topThreeYields.push({
        stoneName,
        planNumber: planGroups[gi].planNumber,
        yieldPct: yieldCandidates[rank].yieldPct,
        rank: rank + 1,
      });
    }

    // Flag unknown shapes for this block
    for (const row of rows) {
      if (!row.shapeKnown && row.shapeRaw) {
        validationWarnings.push(`Unknown shape "${row.shapeRaw}" in row ${row.rowIndex}`);
      }
      if (row.emeraldIssue) {
        validationWarnings.push(`EMERALD 5STEP: ${row.emeraldIssue} in row ${row.rowIndex}`);
        result.validationIssues.push({
          severity: "BLOCKING",
          row: row.rowIndex,
          message: `EMERALD 5STEP validation: ${row.emeraldIssue}`,
        });
      }
    }

    result.blocks.push({
      stoneName,
      parsed,
      roughWeight,
      rows,
      planGroups,
      blueMainLimit: BLUE_MAIN_PLAN_LIMIT,
      whiteMainLimit: WHITE_MAIN_PLAN_LIMIT,
      validationWarnings,
    });
  }

  return result;
}
