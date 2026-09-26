// Sarin import foundation: persistence integrity and permission defaults.
//
// Every database test here writes through Prisma or raw SQL against the isolated
// planning_sectest database and asserts what the database itself accepts or refuses:
// the rules live in the migration, so they are proven where they are enforced. Permission
// tests cross the real server boundary — principal resolution through withApi on
// /api/auth/me, and the existing role- and user-administration routes. Denial of the
// Sarin upload and read routes themselves is covered by sarin-ingestion.test.ts.
//
// All data is synthetic. No customer file or stone name is used.

import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import {
  EXPLICIT_GRANT_PERMISSIONS,
  EXPORT_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";
import {
  SARIN_IMPORT_STATUSES,
  SARIN_OVERRIDE_KINDS,
  SARIN_SHAPE_MAPPING_CONDITION_KINDS,
  SARIN_SHAPE_MAPPING_SET_STATUSES,
  SARIN_SOURCE_ROW_OUTCOMES,
  SARIN_STONE_BLOCK_PARSE_STATUSES,
  SARIN_STONE_TYPES,
  SARIN_VALIDATION_ISSUE_STATUSES,
  SARIN_VALIDATION_SEVERITIES,
} from "@/lib/sarin/domain";

const SARIN_TABLES = [
  "SarinPlanPiece",
  "SarinPlanOption",
  "SarinOutputVersion",
  "SarinRowInterpretation",
  "SarinValidationAttempt",
  "SarinIssueOverride",
  "SarinValidationIssue",
  "SarinStoneBlock",
  "SarinSourceRow",
  "SarinImportBatch",
  "SarinSourceFileContent",
  "SarinSourceFile",
];

// TRUNCATE bypasses the row-level immutability triggers by design; mapping sets are not
// truncated, so the migration's baseline set survives and test sets use unique versions.
async function resetSarin() {
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_TABLES.map((t) => `"${t}"`).join(", ")}`);
}

const PLANNING_DATE = new Date("2026-09-26T00:00:00.000Z");
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
let seq = 0;
const nextVersion = () => 100_000 + Math.floor(Math.random() * 1_000_000_000);

async function makeSourceFile(o: { text?: string; name?: string } = {}) {
  seq++;
  const bytes = Buffer.from(o.text ?? `900X-${String(seq).padStart(3, "0")} ZZ,5.413,ROUND,1.664,IF,D,61.6,1,7.62,7.62,4.69\n`, "utf8");
  return db.$transaction(async (tx) => {
    const file = await tx.sarinSourceFile.create({
      data: { sha256: sha256(bytes), originalFileName: o.name ?? "synthetic.csv", sanitizedFileName: "synthetic.csv", byteSize: bytes.length, detectedEncoding: "UTF-8" },
    });
    await tx.sarinSourceFileContent.create({ data: { sourceFileId: file.id, content: bytes } });
    return file;
  });
}

async function makeBatch(o: { sourceFileId?: string; stoneType?: string; country?: string; labScope?: string | null; uploader?: string } = {}) {
  const sourceFileId = o.sourceFileId ?? (await makeSourceFile()).id;
  return db.sarinImportBatch.create({
    data: {
      sourceFileId,
      stoneType: o.stoneType ?? "BLUE",
      country: o.country ?? "IN",
      labScope: o.labScope ?? null,
      contractVersion: "SARIN_RAW_CSV_V1",
      planningDate: PLANNING_DATE,
      uploadedByUserId: o.uploader ?? "user-synthetic",
    },
  });
}

type RowInput = {
  outcome?: string;
  fieldCount?: number;
  rawLine?: string;
  rowHash?: string;
  stoneNameRaw?: string | null;
  roughWeight?: string | null;
  shapeRaw?: string | null;
  estimatedWeight?: string | null;
};

function makeRow(batchId: string, sourceRowNumber: number, o: RowInput = {}) {
  const rawLine = o.rawLine ?? `900X-001 ZZ,5.413,ROUND,1.664,IF,D,61.6,1,7.62,7.62,4.69#${sourceRowNumber}`;
  const fieldCount = o.fieldCount ?? 11;
  const outcome = o.outcome ?? "ACCEPTED";
  return db.sarinSourceRow.create({
    data: {
      batchId,
      sourceRowNumber,
      rawLine,
      fieldCount,
      rowHash: o.rowHash ?? sha256(rawLine),
      outcome,
      // Row evidence required since the ingestion migration: the fields as read, and a
      // reason whenever the row is not ACCEPTED.
      rawFieldsJson: JSON.stringify(Array.from({ length: fieldCount }, (_, i) => `f${i + 1}`)),
      rejectionCodes: outcome === "ACCEPTED" ? null : "SYNTHETIC_REASON",
      stoneNameRaw: o.stoneNameRaw === undefined ? "900X-001 ZZ" : o.stoneNameRaw,
      roughWeight: o.roughWeight === undefined ? "5.413" : o.roughWeight,
      shapeRaw: o.shapeRaw === undefined ? "ROUND" : o.shapeRaw,
      estimatedWeight: o.estimatedWeight === undefined ? "1.664" : o.estimatedWeight,
    },
  });
}

async function makeRows(batchId: string, count: number) {
  const rows: Awaited<ReturnType<typeof makeRow>>[] = [];
  for (let n = 1; n <= count; n++) rows.push(await makeRow(batchId, n));
  return rows;
}

function makeBlock(batchId: string, o: { blockSequence: number; first: number; last: number; stoneNameRaw?: string }) {
  return db.sarinStoneBlock.create({
    data: {
      batchId,
      blockSequence: o.blockSequence,
      stoneNameRaw: o.stoneNameRaw ?? "900X-001 ZZ",
      firstRowNumber: o.first,
      lastRowNumber: o.last,
      rowCount: o.last - o.first + 1,
    },
  });
}

async function makeSet(rules: Array<{ key: string; shape: string; kind?: string; min?: string | null; max?: string | null }> = []) {
  const set = await db.sarinShapeMappingSet.create({
    data: { sourceSystem: "SARIN", version: nextVersion(), origin: "USER", createdByUserId: "mapper-synthetic" },
  });
  for (const r of rules) await addRule(set.id, r);
  return set;
}

function addRule(mappingSetId: string, r: { key: string; shape: string; kind?: string; min?: string | null; max?: string | null }) {
  return db.sarinShapeMappingRule.create({
    data: {
      mappingSetId,
      rawShapeKey: r.key,
      sourceRawShape: r.key,
      normalizedShape: r.shape,
      conditionKind: r.kind ?? "NONE",
      ratioMin: r.min ?? null,
      ratioMax: r.max ?? null,
    },
  });
}

async function approvedSet(rules: Parameters<typeof makeSet>[0] = [{ key: "ROUND", shape: "Round" }]) {
  const set = await makeSet(rules);
  return db.sarinShapeMappingSet.update({ where: { id: set.id }, data: { status: "APPROVED", approvedByUserId: "approver-synthetic" } });
}

// A worker claims the batch and starts the next validation attempt.
function startValidation(batchId: string, shapeMappingSetId: string | null = null) {
  return db.sarinImportBatch.update({
    where: { id: batchId },
    data: {
      status: "VALIDATING",
      validationAttempt: { increment: 1 },
      fencingVersion: { increment: 1 },
      claimToken: randomUUID(),
      claimedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      shapeMappingSetId,
    },
  });
}

function finishValidation(batchId: string, status: "NEEDS_REVIEW" | "VALIDATED" | "FAILED", failureCode: string | null = null) {
  return db.sarinImportBatch.update({
    where: { id: batchId },
    data: { status, failureCode, claimToken: null, claimedAt: null, leaseExpiresAt: null },
  });
}

async function makeIssue(batchId: string, o: { severity?: string; blocking?: boolean; stoneBlockId?: string; sourceRowId?: string; attempt?: number; setId?: string | null } = {}) {
  const batch = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: batchId } });
  return db.sarinValidationIssue.create({
    data: {
      batchId,
      stoneBlockId: o.stoneBlockId ?? null,
      sourceRowId: o.sourceRowId ?? null,
      validationAttempt: o.attempt ?? batch.validationAttempt,
      shapeMappingSetId: o.setId === undefined ? batch.shapeMappingSetId : o.setId,
      code: "SHAPE_UNMAPPED",
      severity: o.severity ?? "BLOCKING",
      blocking: o.blocking ?? (o.severity === undefined || o.severity === "BLOCKING"),
      fieldPosition: 3,
      fieldName: "shapeRaw",
      parametersJson: JSON.stringify({ rawShapeKey: "HEXAGON" }),
    },
  });
}

function addOverride(issueId: string, o: { kind?: string; supersedes?: string | null; decision?: object | null; reason?: string; by?: string } = {}) {
  const kind = o.kind ?? "ASSIGN_NORMALIZED_SHAPE";
  const decision = o.decision === undefined ? (kind === "ASSIGN_NORMALIZED_SHAPE" ? { normalizedShape: "Round" } : null) : o.decision;
  return db.sarinIssueOverride.create({
    data: {
      issueId,
      kind,
      decisionJson: decision === null ? null : JSON.stringify(decision),
      reason: o.reason ?? "Reviewed against the shape master",
      appliedByUserId: o.by ?? "reviewer-synthetic",
      supersedesOverrideId: o.supersedes ?? null,
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await resetDb();
  await resetSarin();
});

// ---------------------------------------------------------------------------------------
describe("sarin foundation: migration", () => {
  test("every Sarin table and integrity trigger exists", async () => {
    const tables = await db.$queryRaw<{ t: string }[]>`
      SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'Sarin%'`;
    expect(tables.map((r) => r.t).sort()).toEqual([...SARIN_TABLES, "SarinShapeMappingRule", "SarinShapeMappingSet"].sort());
    const triggers = await db.$queryRaw<{ n: string }[]>`
      SELECT tgname AS n FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'sarin_%'`;
    expect(triggers.map((r) => r.n).sort()).toEqual(
      [
        "sarin_import_batch_guard",
        "sarin_import_batch_no_delete",
        "sarin_issue_override_immutable",
        "sarin_issue_override_insert_guard",
        "sarin_shape_mapping_rule_guard",
        "sarin_shape_mapping_set_guard",
        "sarin_shape_mapping_set_no_delete",
        "sarin_source_file_content_immutable",
        "sarin_source_file_content_verify",
        "sarin_source_file_immutable",
        "sarin_source_file_requires_content",
        "sarin_source_row_immutable",
        "sarin_source_row_insert_guard",
        "sarin_stone_block_guard",
        "sarin_stone_block_no_delete",
        "sarin_validation_issue_guard",
        "sarin_validation_issue_no_delete",
        "sarin_row_interpretation_immutable",
        "sarin_row_interpretation_insert_guard",
        "sarin_validation_attempt_guard",
        "sarin_validation_attempt_no_delete",
        "sarin_output_version_guard",
        "sarin_output_version_no_delete",
        "sarin_plan_option_insert_guard",
        "sarin_plan_option_immutable",
        "sarin_plan_piece_insert_guard",
        "sarin_plan_piece_immutable",
      ].sort(),
    );
  });

  test("each CHECK constraint lists exactly the shared vocabulary, no more and no less", async () => {
    const parity: Array<[string, readonly string[]]> = [
      ["SarinImportBatch_stoneType_check", SARIN_STONE_TYPES],
      ["SarinImportBatch_status_check", SARIN_IMPORT_STATUSES],
      ["SarinSourceRow_outcome_check", SARIN_SOURCE_ROW_OUTCOMES],
      ["SarinStoneBlock_parseStatus_check", SARIN_STONE_BLOCK_PARSE_STATUSES],
      ["SarinValidationIssue_severity_check", SARIN_VALIDATION_SEVERITIES],
      ["SarinValidationIssue_status_check", SARIN_VALIDATION_ISSUE_STATUSES],
      ["SarinIssueOverride_kind_check", SARIN_OVERRIDE_KINDS],
      ["SarinShapeMappingSet_status_check", SARIN_SHAPE_MAPPING_SET_STATUSES],
      ["SarinShapeMappingRule_conditionKind_check", SARIN_SHAPE_MAPPING_CONDITION_KINDS],
    ];
    for (const [name, values] of parity) {
      const [row] = await db.$queryRaw<{ def: string }[]>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
      const inDatabase = Array.from(row.def.matchAll(/'([A-Z_]+)'/g), (m) => m[1]).sort();
      expect([name, inDatabase]).toEqual([name, [...values].sort()]);
    }
  });

  test("the confirmed shape master is seeded as an unapproved DRAFT with no unconfirmed values", async () => {
    const set = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { sourceSystem_version: { sourceSystem: "SARIN", version: 1 } }, include: { rules: true } });
    expect([set.status, set.origin, set.approvedAt, set.contentHash]).toEqual(["DRAFT", "MIGRATION_BASELINE", null, null]);
    expect(set.rules).toHaveLength(32);
    const keys = set.rules.map((r) => r.rawShapeKey);
    for (const unconfirmed of ["EMERALD 4STEP", "RAD MODIFIED", "NP-1235-6-KITE", "HEGAZGON", "TREGAL-3", "CU-MO-GCAL-RT-1.42"]) {
      expect(keys.includes(unconfirmed)).toBe(false);
    }
    const emerald = await db.$queryRaw<{ shape: string; min: string | null; max: string | null }[]>`
      SELECT "normalizedShape" AS shape, "ratioMin"::text AS min, "ratioMax"::text AS max
        FROM "SarinShapeMappingRule" WHERE "mappingSetId" = ${set.id} AND "rawShapeKey" = 'EMERALD 5STEP' ORDER BY "ratioMin"`;
    expect(emerald).toEqual([
      { shape: "Asscher", min: "1.000", max: "1.030" },
      { shape: "Emerald", min: "1.400", max: null },
    ]);
  });

  test("a batch cannot be validated against the unapproved baseline set", async () => {
    const baseline = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { sourceSystem_version: { sourceSystem: "SARIN", version: 1 } } });
    const batch = await makeBatch();
    await expect(startValidation(batch.id, baseline.id)).rejects.toThrow(/APPROVED mapping set/);
  });
});

// ---------------------------------------------------------------------------------------
describe("sarin foundation: immutable source files", () => {
  test("content must match the recorded SHA-256 and byte size", async () => {
    const bytes = Buffer.from("synthetic,content\n");
    const wrongSha = db.$transaction(async (tx) => {
      const f = await tx.sarinSourceFile.create({ data: { sha256: sha256("something else"), originalFileName: "a.csv", sanitizedFileName: "a.csv", byteSize: bytes.length, detectedEncoding: "UTF-8" } });
      await tx.sarinSourceFileContent.create({ data: { sourceFileId: f.id, content: bytes } });
    });
    await expect(wrongSha).rejects.toThrow(/does not match the recorded SHA-256/);
    const wrongSize = db.$transaction(async (tx) => {
      const f = await tx.sarinSourceFile.create({ data: { sha256: sha256(bytes), originalFileName: "a.csv", sanitizedFileName: "a.csv", byteSize: bytes.length + 1, detectedEncoding: "UTF-8" } });
      await tx.sarinSourceFileContent.create({ data: { sourceFileId: f.id, content: bytes } });
    });
    await expect(wrongSize).rejects.toThrow(/does not match the recorded byte size/);
    expect(await db.sarinSourceFile.count({ where: { sha256: sha256(bytes) } })).toBe(0);
  });

  test("a file record cannot be committed without its bytes", async () => {
    const orphan = db.sarinSourceFile.create({ data: { sha256: sha256("orphan"), originalFileName: "o.csv", sanitizedFileName: "o.csv", byteSize: 6, detectedEncoding: "UTF-8" } });
    await expect(orphan).rejects.toThrow(/committed without its content/);
  });

  test("SHA-256 is unique, and an unsafe sanitized name is refused", async () => {
    const f = await makeSourceFile({ text: "unique-content\n" });
    await expect(makeSourceFile({ text: "unique-content\n" })).rejects.toThrow(/Unique constraint/);
    for (const bad of ["../etc/passwd", "a\\b.csv", "line\nbreak.csv"]) {
      const attempt = db.$transaction(async (tx) => {
        await tx.sarinSourceFile.create({ data: { sha256: sha256(bad), originalFileName: bad, sanitizedFileName: bad, byteSize: 1, detectedEncoding: "UTF-8" } });
      });
      await expect(attempt).rejects.toThrow(/sanitizedFileName_check/);
    }
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("file metadata and content can be neither updated nor deleted", async () => {
    const f = await makeSourceFile();
    await expect(db.sarinSourceFile.update({ where: { id: f.id }, data: { originalFileName: "renamed.csv" } })).rejects.toThrow(/insert-only/);
    await expect(db.sarinSourceFile.delete({ where: { id: f.id } })).rejects.toThrow(/insert-only/);
    await expect(db.sarinSourceFileContent.update({ where: { sourceFileId: f.id }, data: { content: Buffer.from("x") } })).rejects.toThrow(/insert-only/);
    await expect(db.sarinSourceFileContent.delete({ where: { sourceFileId: f.id } })).rejects.toThrow(/insert-only/);
    const kept = await db.sarinSourceFileContent.findUniqueOrThrow({ where: { sourceFileId: f.id } });
    expect(sha256(Buffer.from(kept.content))).toBe(f.sha256);
  });

  test("ordinary queries on source files never carry the bytes", async () => {
    await makeSourceFile();
    const [row] = await db.sarinSourceFile.findMany({ take: 1 });
    expect(Object.keys(row).includes("content")).toBe(false);
    const withBatch = await db.sarinImportBatch.findFirst({ include: { sourceFile: true } });
    if (withBatch) expect(Object.keys(withBatch.sourceFile).includes("content")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
describe("sarin foundation: import batches", () => {
  test("stone type and country have no default and are validated", async () => {
    const f = await makeSourceFile();
    // Each insert omits exactly one column, so the NOT NULL violation can only be that column.
    await expect(db.$executeRaw`
      INSERT INTO "SarinImportBatch" ("id", "sourceFileId", "country", "contractVersion", "planningDate", "uploadedByUserId", "updatedAt")
      VALUES (${randomUUID()}, ${f.id}, 'IN', 'SARIN_RAW_CSV_V1', DATE '2026-09-26', 'u', now())`).rejects.toThrow(/23502/); // not_null_violation: stoneType
    await expect(db.$executeRaw`
      INSERT INTO "SarinImportBatch" ("id", "sourceFileId", "stoneType", "contractVersion", "planningDate", "uploadedByUserId", "updatedAt")
      VALUES (${randomUUID()}, ${f.id}, 'BLUE', 'SARIN_RAW_CSV_V1', DATE '2026-09-26', 'u', now())`).rejects.toThrow(/23502/); // not_null_violation: country
    for (const bad of ["UNKNOWN", "white", ""]) {
      await expect(makeBatch({ sourceFileId: f.id, stoneType: bad })).rejects.toThrow(/stoneType_check/);
    }
    for (const bad of [" IN", "", "IN "]) {
      await expect(makeBatch({ sourceFileId: f.id, country: bad })).rejects.toThrow(/country_check/);
    }
    await expect(makeBatch({ sourceFileId: f.id, labScope: "" })).rejects.toThrow(/labScope_check/);
  });

  test("every declared stone type in the shared vocabulary is accepted", async () => {
    const f = await makeSourceFile();
    for (const stoneType of SARIN_STONE_TYPES) {
      const b = await makeBatch({ sourceFileId: f.id, stoneType });
      expect(b.stoneType).toBe(stoneType);
    }
  });

  test("a batch is born UPLOADED and cannot be inserted in any other state", async () => {
    const f = await makeSourceFile();
    const attempt = db.sarinImportBatch.create({
      data: { sourceFileId: f.id, stoneType: "PINK", country: "IN", contractVersion: "SARIN_RAW_CSV_V1", planningDate: PLANNING_DATE, uploadedByUserId: "u", status: "VALIDATED" },
    });
    await expect(attempt).rejects.toThrow(/created in status UPLOADED/);
    const ok = await makeBatch({ sourceFileId: f.id, stoneType: "PINK" });
    expect([ok.status, ok.validationAttempt, ok.fencingVersion]).toEqual(["UPLOADED", 0, 0]);
  });

  test("duplicate identity includes file, type, contract, country, a NULL lab and the planning date", async () => {
    const f = await makeSourceFile();
    await makeBatch({ sourceFileId: f.id, stoneType: "WHITE" });
    await expect(makeBatch({ sourceFileId: f.id, stoneType: "WHITE" })).rejects.toThrow(/Unique constraint|duplicate_identity/);
    // Each identity component distinguishes a batch.
    await makeBatch({ sourceFileId: f.id, stoneType: "WHITE", labScope: "GIA" });
    await expect(makeBatch({ sourceFileId: f.id, stoneType: "WHITE", labScope: "GIA" })).rejects.toThrow(/Unique constraint|duplicate_identity/);
    await makeBatch({ sourceFileId: f.id, stoneType: "WHITE", country: "BE" });
    await makeBatch({ sourceFileId: f.id, stoneType: "BLUE" });
    await db.sarinImportBatch.create({ data: { sourceFileId: f.id, stoneType: "WHITE", country: "IN", contractVersion: "SARIN_RAW_CSV_V1", planningDate: new Date("2026-09-27T00:00:00.000Z"), uploadedByUserId: "u" } });
    expect(await db.sarinImportBatch.count({ where: { sourceFileId: f.id } })).toBe(5);
  });

  test("the lifecycle moves only along permitted transitions, stamped by the database", async () => {
    const set = await approvedSet();
    const b = await makeBatch();
    await expect(db.sarinImportBatch.update({ where: { id: b.id }, data: { status: "VALIDATED" } })).rejects.toThrow(/cannot move from UPLOADED to VALIDATED/);

    const v1 = await startValidation(b.id, set.id);
    expect([v1.status, v1.validationAttempt, v1.fencingVersion]).toEqual(["VALIDATING", 1, 1]);
    expect(v1.statusChangedAt.getTime()).toBeGreaterThanOrEqual(b.statusChangedAt.getTime());
    await finishValidation(b.id, "NEEDS_REVIEW");
    await startValidation(b.id, set.id);
    const done = await finishValidation(b.id, "VALIDATED");
    expect([done.status, done.validationAttempt, done.fencingVersion]).toEqual(["VALIDATED", 2, 2]);

    await expect(db.sarinImportBatch.update({ where: { id: b.id }, data: { status: "UPLOADED" } })).rejects.toThrow(/cannot move from VALIDATED to UPLOADED/);
    const archived = await db.sarinImportBatch.update({ where: { id: b.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    expect(archived.status).toBe("ARCHIVED");
    await expect(startValidation(b.id, set.id)).rejects.toThrow(/cannot move from ARCHIVED to VALIDATING/);
  });

  test("VALIDATING requires a claim, a numbered attempt and an advancing fence", async () => {
    const b = await makeBatch();
    await expect(db.sarinImportBatch.update({ where: { id: b.id }, data: { status: "VALIDATING", validationAttempt: 1 } })).rejects.toThrow(/validating_is_claimed_check/);
    await expect(
      db.sarinImportBatch.update({ where: { id: b.id }, data: { status: "VALIDATING", claimToken: "t1", claimedAt: new Date(), leaseExpiresAt: new Date(), fencingVersion: 1 } }),
    ).rejects.toThrow(/increment validationAttempt by exactly one/);
    await expect(
      db.sarinImportBatch.update({ where: { id: b.id }, data: { status: "VALIDATING", validationAttempt: 1, claimToken: "t1", claimedAt: new Date(), leaseExpiresAt: new Date() } }),
    ).rejects.toThrow(/must advance fencingVersion/);
    const claimed = await startValidation(b.id);
    await expect(db.sarinImportBatch.update({ where: { id: b.id }, data: { fencingVersion: claimed.fencingVersion - 1 } })).rejects.toThrow(/fencingVersion is monotonic/);
    // A half-written claim is not a state.
    await expect(db.sarinImportBatch.update({ where: { id: b.id }, data: { leaseExpiresAt: null } })).rejects.toThrow(/claim_consistent_check/);
  });

  test("the mapping set is fixed within an attempt; identity and scope never change", async () => {
    const [s1, s2] = [await approvedSet(), await approvedSet()];
    const b = await makeBatch();
    await startValidation(b.id, s1.id);
    await finishValidation(b.id, "NEEDS_REVIEW");
    await expect(db.sarinImportBatch.update({ where: { id: b.id }, data: { shapeMappingSetId: s2.id } })).rejects.toThrow(/change only on entry into VALIDATING/);
    const next = await startValidation(b.id, s2.id);
    expect(next.shapeMappingSetId).toBe(s2.id);
    await expect(db.sarinImportBatch.update({ where: { id: b.id }, data: { country: "BE" } })).rejects.toThrow(/identity and scope/);
    await expect(db.sarinImportBatch.update({ where: { id: b.id }, data: { stoneType: "PINK" } })).rejects.toThrow(/identity and scope/);
    await expect(db.sarinImportBatch.update({ where: { id: b.id }, data: { labScope: "GIA" } })).rejects.toThrow(/identity and scope/);
    await expect(db.sarinImportBatch.update({ where: { id: b.id }, data: { planningDate: new Date("2026-01-01T00:00:00.000Z") } })).rejects.toThrow(/identity and scope/);
  });

  test("FAILED carries a diagnostic code; ARCHIVED carries its time", async () => {
    const b = await makeBatch();
    await startValidation(b.id);
    await expect(finishValidation(b.id, "FAILED")).rejects.toThrow(/failure_code_check/);
    const failed = await finishValidation(b.id, "FAILED", "SOURCE_DECODE_FAILED");
    expect(failed.failureCode).toBe("SOURCE_DECODE_FAILED");
    await expect(db.sarinImportBatch.update({ where: { id: b.id }, data: { status: "ARCHIVED", failureCode: null } })).rejects.toThrow(/archive_consistent_check/);
  });

  test("batches and their source files cannot be deleted", async () => {
    const b = await makeBatch();
    await expect(db.sarinImportBatch.delete({ where: { id: b.id } })).rejects.toThrow(/permanent history/);
    await expect(db.$executeRaw`DELETE FROM "SarinSourceFile" WHERE "id" = ${b.sourceFileId}`).rejects.toThrow(/insert-only/);
  });

  test("deleting the uploader's account through the real admin route leaves the batch intact", async () => {
    const root = await makeUser("sarin.root.delete", "SUPER_ADMIN");
    const leaver = await makeUser("sarin.leaver", "PLANNER");
    const b = await makeBatch({ uploader: leaver.user.id });
    const r = await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "delete", id: leaver.user.id } });
    expect(r.status).toBe(200);
    expect(await db.user.findUnique({ where: { id: leaver.user.id } })).toBeNull();
    const kept = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: b.id } });
    expect(kept.uploadedByUserId).toBe(leaver.user.id);
  });
});

// ---------------------------------------------------------------------------------------
describe("sarin foundation: immutable source rows", () => {
  test("weights persist as fixed three-decimal values and the original line is kept exactly", async () => {
    const b = await makeBatch();
    const line = "900X-007 ZZ,5.4,ROUND,1.7,IF,D,61.6,1,7.62,7.62,4.69";
    await makeRow(b.id, 1, { rawLine: line, roughWeight: "5.4", estimatedWeight: "1.7" });
    const [stored] = await db.$queryRaw<{ rough: string; est: string; raw: string }[]>`
      SELECT "roughWeight"::text AS rough, "estimatedWeight"::text AS est, "rawLine" AS raw
        FROM "SarinSourceRow" WHERE "batchId" = ${b.id} AND "sourceRowNumber" = 1`;
    expect(stored).toEqual({ rough: "5.400", est: "1.700", raw: line });
  });

  test("the row hash is verified against the preserved line", async () => {
    const b = await makeBatch();
    await expect(makeRow(b.id, 1, { rowHash: sha256("a different line") })).rejects.toThrow(/rowHash_matches_rawLine_check/);
  });

  test("an ACCEPTED row is complete; invalid values are refused, never coerced", async () => {
    const b = await makeBatch();
    await expect(makeRow(b.id, 1, { estimatedWeight: null })).rejects.toThrow(/accepted_is_complete_check/);
    await expect(makeRow(b.id, 2, { fieldCount: 10 })).rejects.toThrow(/accepted_is_complete_check/);
    await expect(makeRow(b.id, 3, { roughWeight: "0" })).rejects.toThrow(/roughWeight_positive_check/);
    await expect(makeRow(b.id, 4, { estimatedWeight: "-0.001" })).rejects.toThrow(/estimatedWeight_non_negative_check/);
    await expect(makeRow(b.id, 0)).rejects.toThrow(/sourceRowNumber_positive_check/);
    // A quarantined row keeps the raw line and leaves the unreadable values NULL.
    const q = await makeRow(b.id, 5, { outcome: "QUARANTINED", fieldCount: 10, roughWeight: null, estimatedWeight: null });
    expect([q.roughWeight, q.estimatedWeight]).toEqual([null, null]);
  });

  test("every row outcome in the shared vocabulary is storable and nothing else is", async () => {
    const b = await makeBatch();
    let n = 0;
    for (const outcome of SARIN_SOURCE_ROW_OUTCOMES) {
      const r = await makeRow(b.id, ++n, { outcome });
      expect(r.outcome).toBe(outcome);
    }
    await expect(makeRow(b.id, ++n, { outcome: "SKIPPED" })).rejects.toThrow(/outcome_check/);
  });

  test("row numbers are unique per batch and rows are insert-only", async () => {
    const b = await makeBatch();
    const r = await makeRow(b.id, 1);
    await expect(makeRow(b.id, 1)).rejects.toThrow(/Unique constraint/);
    await expect(db.sarinSourceRow.update({ where: { id: r.id }, data: { shapeRaw: "OVAL" } })).rejects.toThrow(/insert-only/);
    await expect(db.sarinSourceRow.delete({ where: { id: r.id } })).rejects.toThrow(/insert-only/);
  });

  test("no rows can be added once validation has finished", async () => {
    const b = await makeBatch();
    await startValidation(b.id);
    await finishValidation(b.id, "VALIDATED");
    await expect(makeRow(b.id, 1)).rejects.toThrow(/only be added while the batch is UPLOADED or VALIDATING/);
  });
});

// ---------------------------------------------------------------------------------------
describe("sarin foundation: stone blocks", () => {
  test("packet is text with leading zeros kept; parsing happens once and then freezes", async () => {
    const b = await makeBatch({ stoneType: "WHITE" });
    await makeRows(b.id, 3);
    const block = await makeBlock(b.id, { blockSequence: 1, first: 1, last: 3, stoneNameRaw: "2599-001 ZZ" });
    expect([block.parseStatus, block.parsedAt, block.kapan]).toEqual(["PENDING", null, null]);
    await expect(db.sarinStoneBlock.update({ where: { id: block.id }, data: { parseStatus: "PARSED", kapan: "2599", packet: "001" } })).rejects.toThrow(/parsed_is_complete_check/);
    const parsed = await db.sarinStoneBlock.update({ where: { id: block.id }, data: { parseStatus: "PARSED", kapan: "2599", packet: "001", signer: "ZZ", roughWeight: "72.126" } });
    expect([parsed.packet, parsed.parsedAt !== null]).toEqual(["001", true]);
    await expect(db.sarinStoneBlock.update({ where: { id: block.id }, data: { packet: "1" } })).rejects.toThrow(/parsed or quarantined Sarin stone block is immutable/);
    await expect(db.sarinStoneBlock.update({ where: { id: block.id }, data: { stoneNameRaw: "other" } })).rejects.toThrow(/identity and row range/);
    await expect(db.sarinStoneBlock.delete({ where: { id: block.id } })).rejects.toThrow(/permanent history/);
  });

  test("a repeated non-consecutive Stone Name stays a separate block; ranges never overlap", async () => {
    const b = await makeBatch();
    await makeRows(b.id, 6);
    await makeBlock(b.id, { blockSequence: 1, first: 1, last: 2, stoneNameRaw: "900X-001 ZZ" });
    await makeBlock(b.id, { blockSequence: 2, first: 3, last: 4, stoneNameRaw: "900X-002 ZZ" });
    const repeat = await makeBlock(b.id, { blockSequence: 3, first: 5, last: 6, stoneNameRaw: "900X-001 ZZ" });
    expect(repeat.blockSequence).toBe(3);
    expect(await db.sarinStoneBlock.count({ where: { batchId: b.id, stoneNameRaw: "900X-001 ZZ" } })).toBe(2);
    await expect(makeBlock(b.id, { blockSequence: 4, first: 2, last: 3 })).rejects.toThrow(/overlap another block/);
    await expect(makeBlock(b.id, { blockSequence: 3, first: 6, last: 6 })).rejects.toThrow(/Unique constraint|overlap/);
  });

  test("a block must cover real rows of its own batch with a consistent count", async () => {
    const b = await makeBatch();
    await makeRows(b.id, 2);
    await expect(makeBlock(b.id, { blockSequence: 1, first: 1, last: 5 })).rejects.toThrow(/Foreign key|foreign key/);
    const bad = db.sarinStoneBlock.create({ data: { batchId: b.id, blockSequence: 1, stoneNameRaw: "x", firstRowNumber: 1, lastRowNumber: 2, rowCount: 3 } });
    await expect(bad).rejects.toThrow(/row_range_check/);
  });
});

// ---------------------------------------------------------------------------------------
describe("sarin foundation: validation issues", () => {
  test("an issue records the attempt and mapping set that raised it", async () => {
    const set = await approvedSet();
    const b = await makeBatch();
    await startValidation(b.id, set.id);
    await expect(makeIssue(b.id, { attempt: 0 })).rejects.toThrow(/current attempt and mapping set/);
    await expect(makeIssue(b.id, { setId: null })).rejects.toThrow(/current attempt and mapping set/);
    const issue = await makeIssue(b.id);
    expect([issue.validationAttempt, issue.shapeMappingSetId, issue.status]).toEqual([1, set.id, "OPEN"]);
  });

  test("linked rows and blocks must belong to the same batch", async () => {
    const [a, other] = [await makeBatch(), await makeBatch()];
    const [foreignRow] = await makeRows(other.id, 1);
    await startValidation(a.id);
    await expect(makeIssue(a.id, { sourceRowId: foreignRow.id })).rejects.toThrow(/Foreign key|foreign key/);
  });

  test("severity, blocking flag and parameters are constrained", async () => {
    const b = await makeBatch();
    await startValidation(b.id);
    await expect(makeIssue(b.id, { severity: "BLOCKING", blocking: false })).rejects.toThrow(/blocking_consistent_check/);
    await expect(makeIssue(b.id, { severity: "WARNING", blocking: true })).rejects.toThrow(/blocking_consistent_check/);
    for (const severity of SARIN_VALIDATION_SEVERITIES) {
      const i = await makeIssue(b.id, { severity, blocking: severity === "BLOCKING" });
      expect(i.severity).toBe(severity);
    }
    const base = { batchId: b.id, validationAttempt: 1, code: "SHAPE_UNMAPPED", severity: "INFO", blocking: false };
    await expect(db.sarinValidationIssue.create({ data: { ...base, parametersJson: "[1,2]" } })).rejects.toThrow(/parametersJson_check/);
    await expect(db.sarinValidationIssue.create({ data: { ...base, parametersJson: JSON.stringify({ v: "x".repeat(2100) }) } })).rejects.toThrow(/parametersJson_check/);
    await expect(db.sarinValidationIssue.create({ data: { ...base, fieldPosition: 12 } })).rejects.toThrow(/fieldPosition_check/);
    await expect(db.sarinValidationIssue.create({ data: { ...base, code: "lower case" } })).rejects.toThrow(/code_check/);
  });

  test("only the status moves, along permitted transitions, never deleted", async () => {
    const b = await makeBatch();
    await startValidation(b.id);
    const issue = await makeIssue(b.id);
    await expect(db.sarinValidationIssue.update({ where: { id: issue.id }, data: { code: "OTHER_CODE" } })).rejects.toThrow(/immutable apart from its status/);
    await expect(db.sarinValidationIssue.update({ where: { id: issue.id }, data: { status: "OVERRIDDEN", resolvedByUserId: "r" } })).rejects.toThrow(/only while it has an effective override/);
    const resolved = await db.sarinValidationIssue.update({ where: { id: issue.id }, data: { status: "RESOLVED" } });
    expect(resolved.resolvedAt !== null).toBe(true);
    await expect(db.sarinValidationIssue.update({ where: { id: issue.id }, data: { status: "OPEN" } })).rejects.toThrow(/cannot move from RESOLVED to OPEN/);
    await expect(db.sarinValidationIssue.delete({ where: { id: issue.id } })).rejects.toThrow(/permanent history/);
  });
});

// ---------------------------------------------------------------------------------------
describe("sarin foundation: append-only reviewed overrides", () => {
  test("decisions form one linear chain; the issue status follows the effective decision", async () => {
    const b = await makeBatch();
    await startValidation(b.id);
    const issue = await makeIssue(b.id);

    const first = await addOverride(issue.id);
    await db.sarinValidationIssue.update({ where: { id: issue.id }, data: { status: "OVERRIDDEN", resolvedByUserId: "reviewer-synthetic" } });
    await expect(addOverride(issue.id)).rejects.toThrow(/Unique constraint|one_root_per_issue/);

    const second = await addOverride(issue.id, { supersedes: first.id, decision: { normalizedShape: "Oval" } });
    // The superseded decision cannot be superseded again: the chain has one head.
    await expect(addOverride(issue.id, { supersedes: first.id })).rejects.toThrow(/Unique constraint/);

    await expect(db.sarinValidationIssue.update({ where: { id: issue.id }, data: { status: "OPEN" } })).rejects.toThrow(/reopens only after its override is revoked/);
    const revocation = await addOverride(issue.id, { kind: "REVOCATION", supersedes: second.id });
    await expect(addOverride(issue.id, { kind: "REVOCATION", supersedes: revocation.id })).rejects.toThrow(/A revocation cannot be revoked/);
    const reopened = await db.sarinValidationIssue.update({ where: { id: issue.id }, data: { status: "OPEN" } });
    expect([reopened.status, reopened.resolvedAt, reopened.resolvedByUserId]).toEqual(["OPEN", null, null]);

    // Walk the chain from its root: every decision is still there, in order, unchanged.
    const all = await db.sarinIssueOverride.findMany({ where: { issueId: issue.id } });
    const chain = [all.find((o) => o.supersedesOverrideId === null)!];
    for (let next = all.find((o) => o.supersedesOverrideId === chain[0].id); next; next = all.find((o) => o.supersedesOverrideId === chain[chain.length - 1].id)) {
      chain.push(next);
    }
    expect(chain.map((o) => o.id)).toEqual([first.id, second.id, revocation.id]);
    expect(chain.map((o) => o.kind)).toEqual(["ASSIGN_NORMALIZED_SHAPE", "ASSIGN_NORMALIZED_SHAPE", "REVOCATION"]);
    expect(JSON.parse(chain[0].decisionJson!)).toEqual({ normalizedShape: "Round" });
  });

  test("a decision can be neither updated nor deleted", async () => {
    const b = await makeBatch();
    await startValidation(b.id);
    const o = await addOverride((await makeIssue(b.id)).id);
    await expect(db.sarinIssueOverride.update({ where: { id: o.id }, data: { reason: "Rewritten after the fact" } })).rejects.toThrow(/insert-only/);
    await expect(db.sarinIssueOverride.delete({ where: { id: o.id } })).rejects.toThrow(/insert-only/);
  });

  test("a blocking issue cannot be acknowledged; kinds, reasons and targets are constrained", async () => {
    const b = await makeBatch();
    await startValidation(b.id);
    const blocking = await makeIssue(b.id);
    const warning = await makeIssue(b.id, { severity: "WARNING", blocking: false });
    await expect(addOverride(blocking.id, { kind: "ACKNOWLEDGE_WARNING" })).rejects.toThrow(/cannot be acknowledged/);
    const ack = await addOverride(warning.id, { kind: "ACKNOWLEDGE_WARNING" });
    expect(SARIN_OVERRIDE_KINDS.includes(ack.kind as (typeof SARIN_OVERRIDE_KINDS)[number])).toBe(true);
    await expect(addOverride(blocking.id, { reason: "ok" })).rejects.toThrow(/reason_check/);
    await expect(addOverride(blocking.id, { kind: "WAIVE" })).rejects.toThrow(/kind_check/);
    await expect(addOverride(blocking.id, { decision: null })).rejects.toThrow(/kind_payload_check/);
    // A decision cannot supersede another issue's decision.
    await expect(addOverride(blocking.id, { supersedes: ack.id })).rejects.toThrow(/Foreign key|foreign key/);
    const resolved = await makeIssue(b.id, { severity: "INFO", blocking: false });
    await db.sarinValidationIssue.update({ where: { id: resolved.id }, data: { status: "RESOLVED" } });
    await expect(addOverride(resolved.id, { kind: "ACKNOWLEDGE_WARNING" })).rejects.toThrow(/Only an OPEN or OVERRIDDEN/);
  });

  test("concurrent first decisions on one issue: exactly one wins", async () => {
    const b = await makeBatch();
    await startValidation(b.id);
    const issue = await makeIssue(b.id);
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => addOverride(issue.id, { decision: { normalizedShape: `Shape ${i}` } })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.sarinIssueOverride.count({ where: { issueId: issue.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------
describe("sarin foundation: versioned shape mappings", () => {
  test("a version exists once per source system and a set is born an unapproved DRAFT", async () => {
    const v = nextVersion();
    await db.sarinShapeMappingSet.create({ data: { sourceSystem: "SARIN", version: v, origin: "USER", createdByUserId: "m" } });
    await expect(db.sarinShapeMappingSet.create({ data: { sourceSystem: "SARIN", version: v, origin: "USER", createdByUserId: "m" } })).rejects.toThrow(/Unique constraint/);
    await expect(db.sarinShapeMappingSet.create({ data: { sourceSystem: "SARIN", version: nextVersion(), origin: "USER", createdByUserId: "m", status: "APPROVED" } })).rejects.toThrow(/unapproved DRAFT/);
    await expect(db.sarinShapeMappingSet.create({ data: { sourceSystem: "FANTASY", version: nextVersion(), origin: "USER", createdByUserId: "m" } })).rejects.toThrow(/sourceSystem_check/);
    await expect(db.sarinShapeMappingSet.create({ data: { sourceSystem: "SARIN", version: nextVersion(), origin: "USER" } })).rejects.toThrow(/user_origin_has_creator_check/);
  });

  test("ratio ranges for one raw shape can never overlap; unconditional rules are exclusive", async () => {
    const set = await makeSet([{ key: "EMERALD 4STEP", shape: "Asscher", kind: "RATIO_RANGE", min: "1.000", max: "1.030" }]);
    await expect(addRule(set.id, { key: "EMERALD 4STEP", shape: "Emerald", kind: "RATIO_RANGE", min: "1.020", max: "1.100" })).rejects.toThrow(/overlaps an existing rule/);
    await expect(addRule(set.id, { key: "EMERALD 4STEP", shape: "Emerald", kind: "RATIO_RANGE", min: null, max: "1.000" })).rejects.toThrow(/overlaps an existing rule/);
    await addRule(set.id, { key: "EMERALD 4STEP", shape: "Emerald", kind: "RATIO_RANGE", min: "1.400", max: null });
    await expect(addRule(set.id, { key: "EMERALD 4STEP", shape: "Emerald", kind: "RATIO_RANGE", min: "2.000", max: null })).rejects.toThrow(/overlaps an existing rule/);
    await expect(addRule(set.id, { key: "EMERALD 4STEP", shape: "Emerald" })).rejects.toThrow(/overlaps an existing rule/);
    await addRule(set.id, { key: "ROUND", shape: "Round" });
    await expect(addRule(set.id, { key: "ROUND", shape: "Round" })).rejects.toThrow(/overlaps an existing rule|one_unconditional_per_key/);
    await expect(addRule(set.id, { key: "ROUND", shape: "Round", kind: "RATIO_RANGE", min: "0.900", max: "1.100" })).rejects.toThrow(/overlaps an existing rule/);
    await expect(addRule(set.id, { key: "OVAL", shape: "Oval", kind: "RATIO_RANGE", min: "1.500", max: "1.400" })).rejects.toThrow(/range_ordered_check/);
    await expect(addRule(set.id, { key: "OVAL", shape: "Oval", kind: "RATIO_RANGE" })).rejects.toThrow(/range_has_a_bound_check/);
    await expect(addRule(set.id, { key: "OVAL", shape: "Oval", min: "1.000" })).rejects.toThrow(/none_has_no_bounds_check/);
    await expect(addRule(set.id, { key: "oval ", shape: "Oval" })).rejects.toThrow(/rawShapeKey_canonical_check/);
    await expect(addRule(set.id, { key: "OVAL", shape: "Oval", kind: "SHAPE_LIKE" })).rejects.toThrow(/conditionKind_check/);
    // Every condition kind in the shared vocabulary is storable.
    let k = 0;
    for (const kind of SARIN_SHAPE_MAPPING_CONDITION_KINDS) {
      const r = await addRule(set.id, { key: `VOCAB ${++k}`, shape: "Vocabulary", kind, min: kind === "RATIO_RANGE" ? "1.000" : null });
      expect(r.conditionKind).toBe(kind);
    }
  });

  test("two overlapping ranges written concurrently: exactly one is stored", async () => {
    const set = await makeSet();
    const writer = (min: string, max: string) =>
      db.$transaction(async (tx) => {
        await tx.sarinShapeMappingRule.create({
          data: { mappingSetId: set.id, rawShapeKey: "EMERALD 5STEP", sourceRawShape: "EMERALD 5STEP", normalizedShape: "Asscher", conditionKind: "RATIO_RANGE", ratioMin: min, ratioMax: max },
        });
        await sleep(300); // hold the transaction open so the other writer genuinely overlaps
      });
    const results = await Promise.allSettled([writer("1.000", "1.030"), writer("1.010", "1.050")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.sarinShapeMappingRule.count({ where: { mappingSetId: set.id } })).toBe(1);
  });

  test("approval computes a deterministic content hash and freezes the set and its rules", async () => {
    await expect(approvedSet([])).rejects.toThrow(/empty Sarin shape mapping set cannot be approved/);
    const rules = [
      { key: "ROUND", shape: "Round" },
      { key: "EMERALD 5STEP", shape: "Asscher", kind: "RATIO_RANGE", min: "1.000", max: "1.030" },
      { key: "EMERALD 5STEP", shape: "Emerald", kind: "RATIO_RANGE", min: "1.400", max: null },
    ];
    const a = await approvedSet(rules);
    const b = await approvedSet([...rules].reverse());
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.contentHash).toBe(a.contentHash);
    expect(a.approvedAt !== null).toBe(true);
    const different = await approvedSet([{ key: "ROUND", shape: "Round Brilliant" }]);
    expect(different.contentHash === a.contentHash).toBe(false);

    const rule = await db.sarinShapeMappingRule.findFirstOrThrow({ where: { mappingSetId: a.id } });
    await expect(addRule(a.id, { key: "OVAL", shape: "Oval" })).rejects.toThrow(/Rules of a APPROVED/);
    await expect(db.sarinShapeMappingRule.update({ where: { id: rule.id }, data: { normalizedShape: "Changed" } })).rejects.toThrow(/Rules of a APPROVED/);
    await expect(db.sarinShapeMappingRule.delete({ where: { id: rule.id } })).rejects.toThrow(/Rules of a APPROVED/);
    await expect(db.sarinShapeMappingSet.update({ where: { id: a.id }, data: { description: "edited" } })).rejects.toThrow(/approved or retired Sarin shape mapping set is immutable/);
    await expect(db.sarinShapeMappingSet.update({ where: { id: a.id }, data: { status: "DRAFT" } })).rejects.toThrow(/cannot move from APPROVED to DRAFT/);
    await expect(db.sarinShapeMappingSet.update({ where: { id: a.id }, data: { status: "RETIRED" } })).rejects.toThrow(/requires the actor/);
    const retired = await db.sarinShapeMappingSet.update({ where: { id: a.id }, data: { status: "RETIRED", retiredByUserId: "mapper-synthetic" } });
    expect([retired.status, retired.contentHash, retired.retiredAt !== null]).toEqual(["RETIRED", a.contentHash, true]);
    await expect(db.sarinShapeMappingSet.delete({ where: { id: a.id } })).rejects.toThrow(/permanent history/);
  });

  test("a retired set cannot be used for a new validation attempt", async () => {
    const set = await approvedSet();
    await db.sarinShapeMappingSet.update({ where: { id: set.id }, data: { status: "RETIRED", retiredByUserId: "mapper-synthetic" } });
    const batch = await makeBatch();
    await expect(startValidation(batch.id, set.id)).rejects.toThrow(/APPROVED mapping set/);
  });
});

// ---------------------------------------------------------------------------------------
const SARIN_PERMISSIONS = PERMISSIONS.filter((p) => p.startsWith("sarin.")) as Permission[];
const PLANNING_WORKFLOW: Permission[] = ["sarin.import.read", "sarin.import.upload", "sarin.import.validate", "sarin.issue.review", "sarin.output.generate", "sarin.output.export"];

// The approved default policy. Any role not listed holds no Sarin permission.
const EXPECTED_SARIN: Partial<Record<Role, Permission[]>> = {
  SUPER_ADMIN: SARIN_PERMISSIONS.filter((p) => p !== "sarin.output.approve"),
  ADMIN: ["sarin.import.read"],
  PLANNING_MANAGER: [...PLANNING_WORKFLOW, "sarin.issue.override", "sarin.output.approve"],
  PLANNER: PLANNING_WORKFLOW,
  PLANNING_VIEWER: ["sarin.import.read"],
  MFG_MANAGER: ["sarin.import.read"],
  AUDITOR: ["sarin.import.read"],
};
const sarinOf = (perms: readonly string[]) => perms.filter((p) => p.startsWith("sarin.")).sort();

describe("sarin foundation: permission defaults", () => {
  test("all nine Sarin permissions are in the one canonical catalogue, export included", () => {
    expect(SARIN_PERMISSIONS.slice().sort()).toEqual(
      ["sarin.import.read", "sarin.import.upload", "sarin.import.validate", "sarin.issue.review", "sarin.issue.override", "sarin.output.generate", "sarin.output.approve", "sarin.output.export", "sarin.mapping.manage"].sort(),
    );
    expect((EXPORT_PERMISSIONS as readonly string[]).includes("sarin.output.export")).toBe(true);
  });

  test("every role holds exactly its approved Sarin defaults", () => {
    for (const role of ROLES) expect([role, sarinOf(ROLE_PERMISSIONS[role])]).toEqual([role, (EXPECTED_SARIN[role] ?? []).slice().sort()]);
  });

  test("approval is never reached through `ALL`, and only the approval business role holds it", () => {
    expect((EXPLICIT_GRANT_PERMISSIONS as readonly string[]).includes("sarin.output.approve")).toBe(true);
    for (const role of ROLES) {
      expect([role, ROLE_PERMISSIONS[role].includes("sarin.output.approve")]).toEqual([role, role === "PLANNING_MANAGER"]);
    }
    // SUPER_ADMIN keeps every other permission it held before, so nothing else changed.
    const everythingElse = PERMISSIONS.filter((p) => !(EXPLICIT_GRANT_PERMISSIONS as readonly string[]).includes(p));
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.slice().sort()).toEqual(everythingElse.slice().sort());
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.includes("plan.approve")).toBe(true);
  });

  test("the server-resolved principal of each role carries exactly those Sarin permissions", async () => {
    for (const role of ROLES) {
      const u = await makeUser(`sarin.me.${role.toLowerCase()}`, role);
      const r = await call(me, { cookie: u.cookie, path: "/api/auth/me" });
      expect([role, r.status]).toEqual([role, 200]);
      expect([role, sarinOf(r.json.user.permissions)]).toEqual([role, (EXPECTED_SARIN[role] ?? []).slice().sort()]);
    }
  });

  test("approval is explicitly assignable: a deliberately built role grants it, through the real admin routes", async () => {
    const root = await makeUser("sarin.root.assign", "SUPER_ADMIN");
    const admin = await makeUser("sarin.admin.assign", "ADMIN");
    const planner = await makeUser("sarin.planner.assign", "PLANNER");
    // Roles are not reset between suite runs, so the code is unique per run.
    const code = `SARIN_OUTPUT_APPROVER_${Date.now().toString(36).toUpperCase()}`;
    const body = { op: "createRole", code, name: "Sarin Output Approver", permissions: ["sarin.import.read", "sarin.output.approve"] };

    // ADMIN administers the system but cannot define what a role may do.
    expect((await call(rolesPost, { method: "POST", cookie: admin.cookie, body })).status).toBe(403);

    const created = await call(rolesPost, { method: "POST", cookie: root.cookie, body });
    expect(created.status).toBe(200);
    const before = await call(me, { cookie: planner.cookie, path: "/api/auth/me" });
    expect(before.json.user.permissions.includes("sarin.output.approve")).toBe(false);

    const assigned = await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: planner.user.id, roles: ["PLANNER", code] } });
    expect(assigned.status).toBe(200);
    const after = await call(me, { cookie: planner.cookie, path: "/api/auth/me" });
    expect(after.json.user.permissions.includes("sarin.output.approve")).toBe(true);
    // The planning workflow is still not widened: override and mapping remain withheld.
    expect(after.json.user.permissions.includes("sarin.issue.override")).toBe(false);
    expect(after.json.user.permissions.includes("sarin.mapping.manage")).toBe(false);
  });
});
