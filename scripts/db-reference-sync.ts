import { PrismaClient } from "@prisma/client";
import { syncConfirmedReferenceData } from "../src/lib/reference-data/reference-sync";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Reference data sync refused (URL_MISSING). DATABASE_URL is not set.");
    process.exit(3);
  }
  const db = new PrismaClient();
  try {
    const added = await syncConfirmedReferenceData(db, "cli");
    console.log(`Reference data: ${added.weightBands.length} weight band(s), ${added.labMappings.length} lab mapping(s), ${added.shapeMappings.length} shape mapping(s) added. Existing rows unchanged.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("Reference data sync failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
