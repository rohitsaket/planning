import { PrismaClient } from "@prisma/client";
import { assertDisposableDatabase } from "../src/lib/fantasy/database-environment";
import { launch, tsxInvocation } from "./process-launch";

assertDisposableDatabase(process.env.DATABASE_URL, "Database safety test");
const SECTEST_URL = process.env.DATABASE_URL!;
const db = new PrismaClient();

let failures = 0;
let checks = 0;
function check(ok: boolean, message: string, detail = "") {
  checks++;
  console.log(`  ${ok ? "✓" : "✗"} ${message}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
}

let shellWarnings = 0;
function run(command: readonly string[], env: Record<string, string | undefined> = {}) {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  const r = launch(tsxInvocation(command[0], command.slice(1), { env: merged, stdio: "pipe", encoding: "utf8", timeout: 10 * 60_000 }));
  const output = `${r.stdout}\n${r.stderr}`;
  if (/DEP0190/.test(output)) shellWarnings++;
  return { status: r.status, output };
}

async function tableCounts(): Promise<Record<string, number>> {
  const tables = await db.$queryRaw<Array<{ name: string }>>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const out: Record<string, number> = {};
  for (const { name } of tables) out[name] = Number((await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`))[0].n);
  return out;
}
const diff = (a: Record<string, number>, b: Record<string, number>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((t) => a[t] !== b[t]).map((t) => `${t}: ${a[t]} → ${b[t]}`);

async function fixtureSnapshot() {
  const [metrics, notifications, audit, polished, sales, customers] = await Promise.all([
    db.demandMetric.findMany({ select: { planningCategory: true, roundedTarget: true, physicalShortage: true, pipelineNeed: true }, orderBy: { planningCategory: "asc" } }),
    db.notification.findMany({ select: { type: true, title: true, severity: true }, orderBy: [{ type: "asc" }, { title: "asc" }] }),
    db.auditLog.findMany({ select: { action: true, entity: true }, orderBy: [{ action: "asc" }, { entity: "asc" }] }),
    db.polishedStone.count(),
    db.salesRecord.count(),
    db.customer.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  return JSON.stringify({ metrics, notifications, audit, polished, sales, customers });
}

const FIXTURE = ["scripts/test-demo-fixture.ts"];
const DESTRUCTIVE: Array<[string, string[], { namesOwnTarget?: boolean }]> = [
  ["test demo fixture", FIXTURE, {}],
  ["guarded Prisma reset", ["scripts/db-guard.ts", "prisma-migrate-reset", "--", "migrate", "reset", "--force", "--skip-seed"], {}],
  ["guarded Prisma push with data loss", ["scripts/db-guard.ts", "prisma-db-push", "--", "db", "push", "--accept-data-loss", "--skip-generate"], {}],
  ["test database recreation", ["scripts/sectest-db.ts", "--recreate"], { namesOwnTarget: true }],
  ["Analysis Review fixture load", ["scripts/load-analysis-review-fixture.ts", "--profile=ANALYSIS_REVIEW_V1", "--business-date=2026-09-24", "--confirm-local"], {}],
];
const SETUP = ["scripts/db-setup-dev.ts"];
const REFERENCE = ["scripts/db-reference-sync.ts"];

type Target = { label: string; url: string | undefined; env?: Record<string, string>; refusal: string; setupRefuses: boolean };
const TARGETS: Target[] = [
  { label: "missing URL", url: "", refusal: "URL_MISSING", setupRefuses: true },
  { label: "malformed URL", url: "not a url", refusal: "URL_UNPARSEABLE", setupRefuses: true },
  { label: "remote host", url: "postgresql://u:p@db.invalid:5432/planning_sectest", refusal: "HOST_NOT_LOOPBACK", setupRefuses: true },
  { label: "development database 'planning'", url: "postgresql://u:p@127.0.0.1:1/planning", refusal: "DATABASE_NAME_NOT_DISPOSABLE", setupRefuses: false },
  { label: "unknown database name", url: "postgresql://u:p@127.0.0.1:1/customer_live", refusal: "DATABASE_NAME_NOT_DISPOSABLE", setupRefuses: false },
  { label: "production marker", url: SECTEST_URL, env: { APP_ENV: "production" }, refusal: "DEPLOYED_ENVIRONMENT", setupRefuses: true },
  { label: "staging marker", url: SECTEST_URL, env: { DEPLOY_ENV: "staging" }, refusal: "DEPLOYED_ENVIRONMENT", setupRefuses: true },
];
const CONNECTION_ATTEMPT = /P1001|P1000|ECONNREFUSED|ENOTFOUND|Can't reach database|getaddrinfo|Authentication failed/i;

function refusedBeforeConnecting(label: string, r: { status: number | null; output: string }, refusal: string) {
  check(r.status !== 0 && new RegExp(`refused \\(${refusal}\\)`).test(r.output) && !CONNECTION_ATTEMPT.test(r.output), label, `exit ${r.status}: ${r.output.replace(/\s+/g, " ").slice(0, 240)}`);
}

async function main() {
  console.log("=== 1. Test demo fixture: loads deterministically, with no legacy planning or rough records");
  let r = run(FIXTURE);
  check(r.status === 0, "the fixture loads on the isolated test database", r.output.slice(-400));
  const first = await fixtureSnapshot();
  const legacy = await Promise.all([db.planningCase.count(), db.planVersion.count(), db.planOption.count(), db.planOptionPiece.count(), db.roughReservation.count(), db.roughStone.count(), db.requirementAllocation.count(), db.requirement.count(), db.salesOrder.count(), db.salesOrderLine.count(), db.notification.count({ where: { type: { in: ["PLAN_APPROVAL_PENDING", "REPLAN_REQUIRED", "CRITICAL_REQUIREMENT"] } } })]);
  check(legacy.every((n) => n === 0), "no cases, versions, options, pieces, reservations, rough stones, allocations, requirements, orders, order lines or plan/requirement notifications", legacy.join(","));
  check(JSON.parse(first).metrics.length > 0 && JSON.parse(first).audit.length > 0, "the fixture creates its demo demand categories and audit entries");
  r = run(FIXTURE);
  check(r.status === 0 && (await fixtureSnapshot()) === first, "a second load produces the same records");

  console.log("\n=== 2. Destructive commands refuse unsafe targets before connecting");
  const before = await tableCounts();
  for (const [name, args, opts] of DESTRUCTIVE) {
    for (const t of TARGETS.filter((x) => !(opts.namesOwnTarget && x.refusal === "DATABASE_NAME_NOT_DISPOSABLE"))) {
      const env = { DATABASE_URL: t.url, SECTEST_BASE_URL: t.url, ...(t.env ?? {}) };
      refusedBeforeConnecting(`${name}: ${t.label} → ${t.refusal}`, run(args, env), t.refusal);
    }
  }
  for (const t of TARGETS.filter((x) => x.setupRefuses)) {
    const env = { DATABASE_URL: t.url, SECTEST_BASE_URL: t.url, ...(t.env ?? {}) };
    refusedBeforeConnecting(`development setup: ${t.label} → ${t.refusal}`, run(SETUP, env), t.refusal);
  }
  r = run(REFERENCE, { DATABASE_URL: "" });
  check(r.status !== 0 && /refused \(URL_MISSING\)/.test(r.output), "reference sync: missing URL is refused");
  const after = await tableCounts();
  check(diff(before, after).length === 0, `every one of ${Object.keys(before).length} tables keeps exactly its rows after every refusal`, diff(before, after).join("; "));

  console.log("\n=== 3. Development setup and reference sync never destroy");
  const history = await db.auditLog.create({ data: { actor: "historical.admin", action: "RULE_CHANGE", entity: "BusinessRule", reason: "history that must survive setup" } });
  const edited = await db.labMapping.update({ where: { rawLab: "GIA-Premium" }, data: { normalizedLab: "Edited by an administrator" } });
  await db.shapeMapping.delete({ where: { rawShape: "ROUND" } });
  const beforeSetup = await tableCounts();
  const referenceTables = ["WeightBand", "LabMapping", "ShapeMapping", "AuditLog"];
  r = run(SETUP);
  check(r.status === 0 && !/DEP0190/.test(r.output), "development setup completes on a loopback database, with no shell-argument warning", r.output.slice(-400));
  const afterSetup = await tableCounts();
  const changed = diff(beforeSetup, afterSetup);
  check(changed.every((c) => referenceTables.some((t) => c.startsWith(`${t}:`))), "setup changes no table but the reference tables and the audit log", changed.join("; "));
  check(Object.keys(beforeSetup).every((t) => afterSetup[t] >= beforeSetup[t]), "no table loses a row", changed.join("; "));
  check((await db.auditLog.count({ where: { id: history.id } })) === 1, "audit history survives setup");
  check((await db.labMapping.findUniqueOrThrow({ where: { rawLab: "GIA-Premium" } })).normalizedLab === edited.normalizedLab, "an edited mapping is not overwritten");
  check((await db.shapeMapping.count({ where: { rawShape: "ROUND" } })) === 1, "a missing confirmed mapping is added back");
  const beforeSync = await tableCounts();
  r = run(REFERENCE);
  check(r.status === 0 && diff(beforeSync, await tableCounts()).length === 0, "reference sync run again adds nothing and writes no audit", r.output.slice(-300));

  console.log("\n=== 4. An approved isolated test database resets; setup on it creates no demo data");
  const beforeWrapper = await tableCounts();
  r = run(DESTRUCTIVE[1][1]);
  check(/prisma-migrate-reset: isolated test database planning_sectest/.test(r.output), "the guarded Prisma reset admits planning_sectest and hands over to Prisma", r.output.slice(-300));
  if (/PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION/.test(r.output)) {
    check(diff(beforeWrapper, await tableCounts()).length === 0, "Prisma's own consent gate stopped the AI-initiated reset, and nothing changed");
  }
  await db.$disconnect();
  r = run(["scripts/sectest-db.ts", "--recreate"], { DATABASE_URL: process.env.SECTEST_BASE_URL });
  check(r.status === 0 && /ready: planning_sectest/.test(r.output), "the guarded recreation drops and recreates planning_sectest", r.output.slice(-300));
  r = run(["scripts/db-guard.ts", "test-migrations", "--", "migrate", "deploy"]);
  check(r.status === 0, "the guarded migration run applies every migration to the recreated database", r.output.slice(-300));
  const emptied = await tableCounts();
  check(emptied.Requirement === 0 && emptied.Customer === 0 && emptied.PolishedStone === 0 && emptied._prisma_migrations > 0, "the reset left a migrated database without the fixture's records");
  r = run(SETUP);
  const afterEmptySetup = await tableCounts();
  const created = diff(emptied, afterEmptySetup);
  check(r.status === 0 && !/DEP0190/.test(r.output) && created.every((c) => referenceTables.some((t) => c.startsWith(`${t}:`))), "setup on an empty database creates only confirmed reference rows and their audit", created.join("; "));
  const demo = ["Customer", "SalesRecord", "PolishedStone", "RoughStone", "Requirement", "SalesOrder", "MemoRecord", "DemandRun", "Notification", "IntegrationSyncRun", "DataQualityIssue", "PlanningCase", "LotMasterRecord"];
  check(demo.every((t) => afterEmptySetup[t] === 0), "no demo customers, stones, requirements, orders, demand, notifications, sync runs or plans", demo.filter((t) => afterEmptySetup[t] !== 0).join(", "));
  const addedAudit = afterEmptySetup.AuditLog - emptied.AuditLog;
  check(addedAudit === 3 && (await db.auditLog.count({ where: { action: "REFERENCE_DATA_INSERTED" } })) === addedAudit, "setup writes no audit entry but the three records of reference data it added", `added ${addedAudit}`);

  check(shellWarnings === 0, "no launched command printed a DEP0190 shell-argument warning", `${shellWarnings} command(s) did`);

  console.log(`\nDB SAFETY: ${checks - failures} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main()
  .catch((e) => {
    console.error("FATAL:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
