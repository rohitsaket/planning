import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/errors";
import { log } from "@/lib/api/log";
import type { ApiContext } from "@/lib/api/with-api";
import { scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";
import { SARIN_OUTPUT_EXPORT_MAX_ROWS } from "@/lib/sarin/output-config";
import { outputShape } from "@/lib/sarin/domain";
import { displayYield } from "@/lib/sarin/yield";
import { yieldRankMap } from "@/lib/sarin/yield-rank";
import { SARIN_YIELD_RANK_STYLE, type SarinYieldRank } from "@/lib/sarin/yield-rank-style";
import { columnLetter, excelDateSerial, FORMULA_LIKE, safeSheetName, xmlText, ZipFileWriter, type PartWriter } from "@/lib/sarin/xlsx-writer";

if (typeof window !== "undefined") {
  throw new Error("sarin/output-workbook is server-only and must not be imported by client code.");
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const SARIN_EXPORT_AUDIT = { exported: "SARIN_OUTPUT_EXPORTED", failed: "SARIN_OUTPUT_EXPORT_FAILED" } as const;

export const WORKBOOK_HEADERS = ["NO.", "DATE", "SIGNER NAME", "NO.", "KAPAN", "Packet", "Rough Weight", "", "Shape", "Est. Weight", "Clarity", "Color", "Depth %", "Ratio", "Width", "Length", "MM", "Yield %", "OK"] as const;
const WIDTHS = [6, 11.5, 11, 6, 9, 9, 11, 8, 24, 10, 8, 7, 8, 7, 7, 8, 7, 9, 6];
const STONES_PER_READ = 200;

type Kind = "text" | "quoted" | "int" | "date" | "weight" | "measure" | "percent" | "blank";
type Band = "plain" | "stone" | "groupA" | "groupB" | "rank1" | "rank2" | "rank3";
const KINDS: Kind[] = ["text", "quoted", "int", "date", "weight", "measure", "percent", "blank"];
const BANDS: Band[] = ["plain", "stone", "groupA", "groupB", "rank1", "rank2", "rank3"];
const NUMFMT: Record<Kind, number> = { text: 49, quoted: 49, int: 0, date: 164, weight: 165, measure: 166, percent: 10, blank: 0 };
const FILL: Record<Band, number> = { plain: 0, stone: 3, groupA: 4, groupB: 5, rank1: 6, rank2: 7, rank3: 8 };
const RANK_BAND: Record<SarinYieldRank, Band> = { 1: "rank1", 2: "rank2", 3: "rank3" };
const HEADER_STYLE = 1;
const style = (kind: Kind, band: Band) => 2 + BANDS.indexOf(band) * KINDS.length + KINDS.indexOf(kind);

function stylesXml(): string {
  const xfs = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>',
  ];
  for (const band of BANDS) {
    for (const kind of KINDS) {
      xfs.push(
        `<xf numFmtId="${NUMFMT[kind]}" fontId="0" fillId="${FILL[band]}" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"${kind === "quoted" ? ' quotePrefix="1"' : ""}><alignment horizontal="center" vertical="center"/></xf>`,
      );
    }
  }
  const solid = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const thin = '<left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3"><numFmt numFmtId="164" formatCode="dd\\-mm\\-yyyy"/><numFmt numFmtId="165" formatCode="0.000"/><numFmt numFmtId="166" formatCode="0.00"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
    `<fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${solid("FFE7B84B")}${solid("FFD9DDE0")}${solid("FFDCEEFF")}${solid("FFFFE8CC")}` +
    `${solid(`FF${SARIN_YIELD_RANK_STYLE[1].fill}`)}${solid(`FF${SARIN_YIELD_RANK_STYLE[2].fill}`)}${solid(`FF${SARIN_YIELD_RANK_STYLE[3].fill}`)}</fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${thin}<diagonal/></border></borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>"
  );
}

export interface WorkbookStone {
  readonly id: string;
  readonly sequence: number;
  readonly kapan: string;
  readonly packet: string;
  readonly signer: string;
  readonly roughWeight: string;
  readonly pieces: number;
}
export interface WorkbookPiece {
  readonly stoneId: string;
  readonly optionId: string;
  readonly optionKind: string;
  readonly optionSequence: number;
  readonly optionPieces: number;
  readonly yieldPercent: Prisma.Decimal;
  readonly outputRow: number;
  readonly pieceSequence: number;
  readonly shape: string;
  readonly estimatedWeight: string;
  readonly clarity: string;
  readonly color: string;
  readonly depthPct: string;
  readonly ratio: string;
  readonly width: string;
  readonly length: string;
  readonly depthMm: string;
}
export interface WorkbookSource {
  stones(versionId: string): Promise<WorkbookStone[]>;
  pieces(versionId: string, stoneIds: string[]): Promise<WorkbookPiece[]>;
}

export const databaseWorkbookSource: WorkbookSource = {
  async stones(versionId) {
    const blocks = await db.sarinStoneBlock.findMany({
      where: { planOptions: { some: { outputVersionId: versionId } } },
      orderBy: { blockSequence: "asc" },
      select: { id: true, blockSequence: true, kapan: true, packet: true, signer: true, roughWeight: true },
    });
    const counts = await db.sarinPlanOption.groupBy({ by: ["stoneBlockId"], where: { outputVersionId: versionId }, _sum: { pieceCount: true } });
    const piecesOf = new Map(counts.map((c) => [c.stoneBlockId, c._sum.pieceCount ?? 0]));
    return blocks.map((b) => ({ id: b.id, sequence: b.blockSequence, kapan: b.kapan ?? "", packet: b.packet ?? "", signer: b.signer ?? "", roughWeight: b.roughWeight?.toFixed(3) ?? "", pieces: piecesOf.get(b.id) ?? 0 }));
  },
  async pieces(versionId, stoneIds) {
    const rows = await db.sarinPlanPiece.findMany({
      where: { outputVersionId: versionId, planOption: { stoneBlockId: { in: stoneIds } } },
      orderBy: { outputRowSequence: "asc" },
      select: {
        outputRowSequence: true, pieceSequence: true, normalizedShape: true, rawShape: true, estimatedWeight: true, clarity: true, color: true, depthPct: true, ratio: true, width: true, length: true, depthMm: true,
        planOption: { select: { id: true, stoneBlockId: true, optionKind: true, optionSequence: true, pieceCount: true, yieldPercent: true } },
      },
    });
    return rows.map((p) => ({
      stoneId: p.planOption.stoneBlockId, optionId: p.planOption.id, optionKind: p.planOption.optionKind, optionSequence: p.planOption.optionSequence, optionPieces: p.planOption.pieceCount,
      yieldPercent: p.planOption.yieldPercent, outputRow: p.outputRowSequence, pieceSequence: p.pieceSequence, shape: outputShape(p), estimatedWeight: p.estimatedWeight.toFixed(3), clarity: p.clarity, color: p.color,
      depthPct: p.depthPct.toFixed(3), ratio: p.ratio.toFixed(3), width: p.width.toFixed(3), length: p.length.toFixed(3), depthMm: p.depthMm.toFixed(3),
    }));
  },
};

const ref = (col: number, row: number) => `${columnLetter(col)}${row}`;
const textCell = (col: number, row: number, value: string, band: Band) =>
  `<c r="${ref(col, row)}" s="${style(FORMULA_LIKE.test(value) ? "quoted" : "text", band)}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
const numberCell = (col: number, row: number, value: string | number, kind: Kind, band: Band) => `<c r="${ref(col, row)}" s="${style(kind, band)}"><v>${value}</v></c>`;
const blankCell = (col: number, row: number, band: Band) => `<c r="${ref(col, row)}" s="${style("blank", band)}"/>`;

const yieldFraction = (percent: Prisma.Decimal) => new Prisma.Decimal(displayYield(percent)).dividedBy(100).toString();

export interface WorkbookFacts {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly packetType: string;
  readonly planningDate: string;
  readonly generatedAt: Date;
  readonly transformProfileVersion: string;
  readonly validationProfileVersion: string;
}

export async function buildOutputWorkbook(facts: WorkbookFacts, source: WorkbookSource): Promise<{ bytes: Buffer; rows: number }> {
  const dir = await mkdtemp(path.join(tmpdir(), "sarin-xlsx-"));
  const file = path.join(dir, "workbook.xlsx");
  const zip = new ZipFileWriter(file, new Date());
  try {
    const stones = await source.stones(facts.versionId);
    const sheets: Array<{ name: string; stones: WorkbookStone[] }> = [];
    const taken = new Set<string>();
    if (facts.packetType === "PINK") {
      sheets.push({ name: safeSheetName("Sheet1", taken), stones });
    } else {
      const byKapan = new Map<string, WorkbookStone[]>();
      for (const s of stones) byKapan.set(s.kapan, [...(byKapan.get(s.kapan) ?? []), s]);
      for (const [kapan, list] of byKapan) sheets.push({ name: safeSheetName(kapan, taken), stones: list });
    }
    if (sheets.length === 0) sheets.push({ name: safeSheetName("Sheet1", taken), stones: [] });

    const date = excelDateSerial(facts.planningDate);
    let rows = 0;
    for (const [index, sheet] of sheets.entries()) {
      await zip.addEntry(`xl/worksheets/sheet${index + 1}.xml`, async (write) => {
        rows += await writeSheet(write, sheet.stones, facts, date, source);
      });
    }
    await writePackageParts(zip, sheets.map((s) => ({ name: s.name, lastRow: 1 + s.stones.reduce((n, st) => n + st.pieces, 0) })), facts);
    await zip.finish();
    return { bytes: await readFile(file), rows };
  } catch (e) {
    await zip.abort();
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function stoneYieldRanks(pieces: readonly WorkbookPiece[]): Map<string, SarinYieldRank> {
  const options = new Map<string, { piece: WorkbookPiece; rows: number[] }>();
  for (const p of pieces) {
    const o = options.get(p.optionId);
    if (o) o.rows.push(p.outputRow);
    else options.set(p.optionId, { piece: p, rows: [p.outputRow] });
  }
  return yieldRankMap(
    [...options.values()].map(({ piece, rows }) => ({ stoneId: piece.stoneId, optionId: piece.optionId, optionSequence: piece.optionSequence, pieceCount: piece.optionPieces, yieldPercent: piece.yieldPercent, outputRows: rows })),
  );
}

const LAST_COLUMN = columnLetter(WORKBOOK_HEADERS.length - 1);

async function writeSheet(write: PartWriter, stones: WorkbookStone[], facts: WorkbookFacts, date: number, source: WorkbookSource): Promise<number> {
  const lastRow = 1 + stones.reduce((n, s) => n + s.pieces, 0);
  await write(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      `<dimension ref="A1:${LAST_COLUMN}${lastRow}"/>` +
      '<sheetViews><sheetView workbookViewId="0" zoomScale="90" zoomScaleNormal="90"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="18" customHeight="1"/>' +
      `<cols>${WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
      `<sheetData><row r="1" spans="1:${WORKBOOK_HEADERS.length}" ht="30" customHeight="1">${WORKBOOK_HEADERS.map((h, i) => `<c r="${ref(i, 1)}" s="${HEADER_STYLE}" t="inlineStr"><is><t>${xmlText(h)}</t></is></c>`).join("")}</row>`,
  );
  const merges: string[] = [];
  let row = 1;
  let stoneNumber = 0;
  for (let i = 0; i < stones.length; i += STONES_PER_READ) {
    const batch = stones.slice(i, i + STONES_PER_READ);
    const pieces = await source.pieces(facts.versionId, batch.map((s) => s.id));
    const byStone = new Map<string, WorkbookPiece[]>();
    for (const p of pieces) byStone.set(p.stoneId, [...(byStone.get(p.stoneId) ?? []), p]);
    for (const stone of batch) {
      stoneNumber++;
      const ranks = stoneYieldRanks(byStone.get(stone.id) ?? []);
      let plan = 0;
      let group = 0;
      let optionBand: Band = "plain";
      const out: string[] = [];
      for (const p of byStone.get(stone.id) ?? []) {
        row++;
        plan++;
        const first = plan === 1;
        const startsOption = p.pieceSequence === 1;
        if (startsOption && p.optionKind === "ADDITIONAL") group++;
        if (startsOption) optionBand = p.optionKind === "ADDITIONAL" ? (group % 2 === 1 ? "groupA" : "groupB") : "plain";
        const rowBand: Band = first ? "stone" : "plain";
        const rank = ranks.get(p.optionId);
        const rankBand = rank ? RANK_BAND[rank] : null;
        const optBand: Band = rankBand && facts.packetType === "PINK" ? rankBand : first ? "stone" : optionBand;
        const yieldBand: Band = rankBand ?? rowBand;
        const cells = [
          numberCell(0, row, plan, "int", rowBand),
          first ? numberCell(1, row, date, "date", rowBand) : blankCell(1, row, rowBand),
          first ? textCell(2, row, stone.signer, rowBand) : blankCell(2, row, rowBand),
          first ? numberCell(3, row, stoneNumber, "int", rowBand) : blankCell(3, row, rowBand),
          first ? textCell(4, row, stone.kapan, rowBand) : blankCell(4, row, rowBand),
          textCell(5, row, stone.packet, rowBand),
          numberCell(6, row, stone.roughWeight, "weight", rowBand),
        ];
        const label = p.optionKind === "MAIN" ? "" : p.optionKind === "ADDITIONAL" ? `${p.optionPieces} Pcs` : p.optionKind;
        cells.push(startsOption && label ? textCell(7, row, label, optBand) : blankCell(7, row, optBand));
        cells.push(
          textCell(8, row, p.shape, optBand),
          numberCell(9, row, p.estimatedWeight, "weight", optBand),
          textCell(10, row, p.clarity, optBand),
          textCell(11, row, p.color, optBand),
          numberCell(12, row, p.depthPct, "measure", optBand),
          numberCell(13, row, p.ratio, "measure", optBand),
          numberCell(14, row, p.width, "measure", optBand),
          numberCell(15, row, p.length, "measure", optBand),
          numberCell(16, row, p.depthMm, "measure", optBand),
          startsOption ? numberCell(17, row, yieldFraction(p.yieldPercent), "percent", yieldBand) : blankCell(17, row, yieldBand),
          blankCell(18, row, "plain"),
        );
        if (startsOption && p.optionPieces > 1) merges.push(`H${row}:H${row + p.optionPieces - 1}`, `R${row}:R${row + p.optionPieces - 1}`);
        out.push(`<row r="${row}" spans="1:${WORKBOOK_HEADERS.length}">${cells.join("")}</row>`);
      }
      await write(out.join(""));
    }
  }
  if (row !== lastRow) throw new Error("workbook sheet rows do not match the stored output");
  await write(
    "</sheetData>" +
      (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "") +
      '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      "</worksheet>",
  );
  return row - 1;
}

async function writePackageParts(zip: ZipFileWriter, sheets: Array<{ name: string; lastRow: number }>, facts: WorkbookFacts) {
  const sheetNames = sheets.map((s) => s.name);
  const one = (xml: string) => async (write: PartWriter) => write(xml);
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  await zip.addEntry(
    "[Content_Types].xml",
    one(
      head +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheetNames.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
    ),
  );
  await zip.addEntry(
    "_rels/.rels",
    one(
      head +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
    ),
  );
  const quoted = (n: string) => `'${n.replace(/'/g, "''")}'`;
  await zip.addEntry(
    "xl/workbook.xml",
    one(
      head +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>' +
        sheetNames.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        "</sheets><definedNames>" +
        sheets.map((s, i) => `<definedName name="_xlnm.Print_Area" localSheetId="${i}">${xmlText(quoted(s.name))}!$A$1:$${LAST_COLUMN}$${s.lastRow}</definedName>`).join("") +
        sheetNames.map((n, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xmlText(quoted(n))}!$1:$1</definedName>`).join("") +
        "</definedNames></workbook>",
    ),
  );
  await zip.addEntry(
    "xl/_rels/workbook.xml.rels",
    one(
      head +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
  );
  await zip.addEntry("xl/styles.xml", one(stylesXml()));
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  await zip.addEntry(
    "docProps/core.xml",
    one(
      head +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>Sarin structured output</dc:title><dc:subject>${xmlText(`Output version ${facts.versionNumber} · ${facts.packetType} · planning date ${facts.planningDate}`)}</dc:subject>` +
        `<dc:description>${xmlText(`Transformed Sarin candidate data. Not an approved manufacturing plan. Transformation ${facts.transformProfileVersion}; validation ${facts.validationProfileVersion}.`)}</dc:description>` +
        `<dc:creator>Diamond Planning</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,
    ),
  );
  await zip.addEntry("docProps/app.xml", one(head + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Diamond Planning</Application></Properties>'));
}

export interface WorkbookExportActor {
  readonly userId: string;
  readonly scope: EffectiveScope;
  readonly audit: ApiContext<unknown>["audit"];
  readonly requestId: string;
}

export async function exportOutputWorkbook(
  actor: WorkbookExportActor,
  batchId: string,
  versionId: string,
  options: { maxRows?: number; source?: WorkbookSource } = {},
): Promise<{ bytes: Buffer; fileName: string; rows: number } | null> {
  const maxRows = options.maxRows ?? SARIN_OUTPUT_EXPORT_MAX_ROWS;
  const version = await db.sarinOutputVersion.findFirst({
    where: { id: versionId, batchId, batch: scopeWhere(actor.scope, { country: null, lab: "labScope" }) as Prisma.SarinImportBatchWhereInput },
    select: {
      id: true, versionNumber: true, packetType: true, pieceCount: true, generatedAt: true, validationProfileVersion: true, transformProfileVersion: true,
      batch: { select: { planningDate: true } },
    },
  });
  if (!version) return null;
  const record = async (outcome: "SUCCESS" | "FAILED", after: Record<string, unknown>, reason: string) => {
    try {
      await actor.audit(db, { action: outcome === "SUCCESS" ? SARIN_EXPORT_AUDIT.exported : SARIN_EXPORT_AUDIT.failed, entity: "SarinImportBatch", entityId: batchId, outcome, after: { outputVersionId: version.id, versionNumber: version.versionNumber, format: "XLSX", ...after }, reason });
    } catch {
      log("error", "sarin.workbook.audit_failed", { requestId: actor.requestId, batchId });
    }
  };
  if (version.pieceCount > maxRows) {
    await record("FAILED", { code: "EXPORT_TOO_LARGE", rows: version.pieceCount }, "Sarin structured workbook refused: over the export row limit");
    throw new ApiError(413, "EXPORT_TOO_LARGE", `This output has ${version.pieceCount} pieces, more than the ${maxRows} one export may contain.`);
  }
  const planningDate = version.batch.planningDate.toISOString().slice(0, 10);
  try {
    const built = await buildOutputWorkbook(
      {
        versionId: version.id, versionNumber: version.versionNumber, packetType: version.packetType, planningDate, generatedAt: version.generatedAt,
        transformProfileVersion: version.transformProfileVersion, validationProfileVersion: version.validationProfileVersion,
      },
      options.source ?? databaseWorkbookSource,
    );
    if (built.rows !== version.pieceCount) throw new Error("workbook row count does not match the output version");
    await record("SUCCESS", { rows: built.rows }, "Sarin structured workbook exported");
    return { bytes: built.bytes, rows: built.rows, fileName: `sarin-output-v${version.versionNumber}-${version.packetType.toLowerCase()}-${planningDate}.xlsx` };
  } catch (e) {
    log("error", "sarin.workbook.failed", { requestId: actor.requestId, batchId, error: e instanceof Error ? e.name : "unknown" });
    await record("FAILED", { code: "EXPORT_NOT_GENERATED" }, "Sarin structured workbook could not be generated; nothing was kept");
    throw new ApiError(500, "EXPORT_NOT_GENERATED", "The workbook could not be generated. Nothing was kept; try again.");
  }
}
