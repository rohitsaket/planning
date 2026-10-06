import type { Prisma, PrismaClient } from "@prisma/client";
import { CONFIRMED_LAB_MAPPINGS, CONFIRMED_SHAPE_MAPPINGS, CONFIRMED_WEIGHT_BANDS } from "@/lib/domain/diamond-rules";

if (typeof window !== "undefined") {
  throw new Error("reference-data/reference-sync is server-only and must not be imported by client code.");
}

export interface ReferenceSyncResult {
  readonly weightBands: string[];
  readonly labMappings: string[];
  readonly shapeMappings: string[];
}

type Tx = Prisma.TransactionClient;

async function auditInserted(tx: Tx, actor: string, entity: string, keys: string[]) {
  if (keys.length === 0) return;
  await tx.auditLog.create({
    data: {
      actor,
      action: "REFERENCE_DATA_INSERTED",
      entity,
      after: JSON.stringify({ inserted: keys }),
      reason: "Missing confirmed reference data added; existing rows left unchanged",
      outcome: "SUCCESS",
      category: "OPERATIONAL",
    },
  });
}

export async function syncConfirmedReferenceData(client: PrismaClient, actor: string): Promise<ReferenceSyncResult> {
  return client.$transaction(async (tx) => {
    const bands = await tx.weightBand.createManyAndReturn({
      data: CONFIRMED_WEIGHT_BANDS.map((b) => ({ code: b.code, label: b.label, minCt: b.minCt, maxCt: b.maxCt, sortOrder: b.sortOrder, active: true })),
      skipDuplicates: true,
      select: { code: true },
    });
    const labs = await tx.labMapping.createManyAndReturn({
      data: CONFIRMED_LAB_MAPPINGS.filter((m) => m.raw.trim() !== "").map((m) => ({ rawLab: m.raw, normalizedLab: m.normalized, active: true })),
      skipDuplicates: true,
      select: { rawLab: true },
    });
    const shapes = await tx.shapeMapping.createManyAndReturn({
      data: CONFIRMED_SHAPE_MAPPINGS.map((m) => ({ rawShape: m.raw, normalizedShape: m.normalized, active: true })),
      skipDuplicates: true,
      select: { rawShape: true },
    });
    const result: ReferenceSyncResult = {
      weightBands: bands.map((b) => b.code).sort(),
      labMappings: labs.map((l) => l.rawLab).sort(),
      shapeMappings: shapes.map((s) => s.rawShape).sort(),
    };
    await auditInserted(tx, actor, "WeightBand", result.weightBands);
    await auditInserted(tx, actor, "LabMapping", result.labMappings);
    await auditInserted(tx, actor, "ShapeMapping", result.shapeMappings);
    return result;
  });
}
