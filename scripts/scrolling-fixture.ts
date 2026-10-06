// Seeds the isolated scrolling-test database with enough rows for every retained page to
// exceed the viewport, plus row-count boundary sets. Every write goes through the test helpers
// or the real route handlers; the module refuses any database but planning_sectest.

import { call, db, makeUser } from "../tests/security/helpers";
import { SECTEST_DB } from "../tests/security/test-db";
import { assertDisposableDatabase } from "@/lib/fantasy/database-environment";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { POST as uploadImport } from "@/app/api/planning/sarin/imports/route";
import { POST as validateImport } from "@/app/api/planning/sarin/imports/[batchId]/validate/route";
import { POST as generateOutput } from "@/app/api/planning/sarin/imports/[batchId]/outputs/route";

/** Row counts around the old 50-row switch, and a count that needs server pagination. */
export const BOUNDARY_COUNTS = [0, 1, 25, 49, 50, 51, 300] as const;
/** Search token that selects exactly `n` seeded rows on a page. */
export const boundaryToken = (n: number) => `zq${String(n).padStart(3, "0")}x`;

// One Pink stone (27 plans, 45 lines) that validates and produces a stored output. Columns:
// shape, estimated weight, ratio; the rest of each line is fixed.
const PINK_LINES: ReadonlyArray<readonly [string, string, string]> = [
  ["ROUND", "0.300", "1.000"],
  ["ROUND", "0.300", "1.000"],
  ["ROUND", "0.080", "1.000"],
  ["LeoPear11", "0.310", "1.500"],
  ["LeoPear11", "0.310", "1.500"],
  ["ROUND", "0.080", "1.000"],
  ["LeoOval22", "0.320", "1.350"],
  ["LeoOval22", "0.320", "1.350"],
  ["ROUND", "0.080", "1.000"],
  ["EMERALD 5STEP", "0.330", "1.000"],
  ["EMERALD 5STEP", "0.330", "1.000"],
  ["ROUND", "0.080", "1.000"],
  ["EMERALD 5STEP", "0.340", "1.450"],
  ["EMERALD 5STEP", "0.340", "1.450"],
  ["ROUND", "0.080", "1.000"],
  ["RAD4(1)", "0.350", "1.200"],
  ["RAD4(1)", "0.350", "1.200"],
  ["ROUND", "0.080", "1.000"],
  ["BE.CU.LONG", "0.360", "1.050"],
  ["BE.CU.LONG", "0.360", "1.050"],
  ["ROUND", "0.080", "1.000"],
  ["ANTIK-CU-LONG", "0.370", "1.100"],
  ["ANTIK-CU-LONG", "0.370", "1.100"],
  ["ROUND", "0.080", "1.000"],
  ["S.HEART", "0.380", "0.950"],
  ["S.HEART", "0.380", "0.950"],
  ["ROUND", "0.080", "1.000"],
  ["EMERALD 5STEP", "0.150", "1.450"],
  ["ROUND", "0.150", "1.000"],
  ["LeoOval22", "0.150", "1.350"],
  ["ROUND", "0.150", "1.000"],
  ["EMERALD 5STEP", "0.150", "1.450"],
  ["LeoOval22", "0.150", "1.350"],
  ["ROUND", "0.120", "1.000"],
  ["ROUND", "0.120", "1.000"],
  ["LeoOval22", "0.120", "1.350"],
  ["LeoOval22", "0.124", "1.350"],
  ["EMERALD 5STEP", "0.120", "1.450"],
  ["EMERALD 5STEP", "0.120", "1.450"],
  ["RAD4(1)", "0.120", "1.200"],
  ["RAD4(1)", "0.120", "1.200"],
  ["BE.CU.LONG", "0.120", "1.050"],
  ["BE.CU.LONG", "0.120", "1.050"],
  ["ANTIK-CU-LONG", "0.120", "1.100"],
  ["ANTIK-CU-LONG", "0.120", "1.100"],
];
const pinkCsv = (stone: string) => PINK_LINES.map(([shape, est, ratio]) => [stone, "2.000", shape, est, "VS1", "G", "61.6", ratio, "7.62", "7.58", "4.69"].join(",")).join("\n") + "\n";

async function uploadPink(cookie: string, stone = "7201-333_M"): Promise<string> {
  const fd = new FormData();
  fd.append("file", new File([new TextEncoder().encode(pinkCsv(stone)) as BlobPart], "sarin.csv", { type: "text/csv" }));
  fd.append("packetType", "PINK");
  fd.append("planningDate", "2026-09-28");
  const encoded = new Response(fd);
  const body = new Uint8Array(await encoded.arrayBuffer());
  resetRateLimits();
  const res = await uploadImport(
    new Request("http://localhost:3000/api/planning/sarin/imports", { method: "POST", headers: { cookie, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) }, body }),
    { params: Promise.resolve({}) } as never,
  );
  if (res.status !== 201) throw new Error(`Sarin upload failed with ${res.status}`);
  const batchId = ((await res.json()) as { batch: { id: string } }).batch.id;
  resetRateLimits();
  await call(validateImport as never, { method: "POST", cookie, body: {}, params: { batchId } });
  resetRateLimits();
  const out = await call(generateOutput as never, { method: "POST", cookie, body: {}, params: { batchId } });
  if (out.status >= 400) throw new Error(`Sarin output failed with ${out.status}`);
  return batchId;
}

export async function assertScrollingTestDatabase() {
  // Loopback host, an approved isolated test database, no production or staging marker —
  // proven from the URL before the connection is used.
  assertDisposableDatabase(process.env.DATABASE_URL, "Scrolling fixture");
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (name !== SECTEST_DB) throw new Error(`Refusing to seed ${name}: the scrolling suite runs only against ${SECTEST_DB}.`);
}

/** Seeds the data and returns the Super Admin session cookie value the browser uses. */
export async function seedScrollingFixture(): Promise<{ sessionToken: string }> {
  await assertScrollingTestDatabase();
  const root = await makeUser("scroll.root", "SUPER_ADMIN", "Scroll Admin");
  const planner = await makeUser("scroll.planner", "PLANNER", "Scroll Planner");
  for (let i = 0; i < 60; i++) await makeUser(`scroll.user${i}`, i % 3 ? "VIEWER" : "PLANNER", `Scroll Member ${i}`);

  // Import Issues: boundary sets selected by a search token, 476 rows in all.
  const issues = BOUNDARY_COUNTS.flatMap((n) =>
    Array.from({ length: n }, (_, i) => ({
      issueCode: `SCROLL-${n}-${i}`, source: "FANTASY", entity: "LOT", recordId: `LOT-${boundaryToken(n)}-${String(i).padStart(3, "0")}`,
      rule: "UNMAPPED_LAB_WARNING", message: `Recorded problem ${boundaryToken(n)} ${i}`, severity: ["WARNING", "ERROR", "INFO", "BLOCKING"][i % 4], status: "OPEN",
    })),
  );
  await db.dataQualityIssue.createMany({ data: issues, skipDuplicates: true });


  // Audit history and mapping tables long enough to scroll.
  await db.auditLog.createMany({
    data: Array.from({ length: 250 }, (_, i) => ({ actor: "scroll.root", action: "SCROLL_FIXTURE", entity: "Role", entityId: `scroll-${i}`, reason: `Fixture entry ${i}` })),
  });
  await db.labMapping.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ rawLab: `ZLAB-${i}`, normalizedLab: "Other" })), skipDuplicates: true });
  await db.shapeMapping.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ rawShape: `ZSHAPE-${i}`, normalizedShape: "ROUND" })), skipDuplicates: true });

  await db.fantasyStatusMapping.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ fantasyStatus: `ZSTATUS-${i}`, planningClass: "OTHER" })), skipDuplicates: true });

  // Workbook Import: the reopened Pink file plus enough further files to page Recent Files.
  await uploadPink(planner.cookie);
  for (let i = 0; i < 15; i++) await uploadPink(planner.cookie, `72${String(i + 10).padStart(2, "0")}-334_M`);
  return { sessionToken: root.cookie.split("=")[1] };
}
