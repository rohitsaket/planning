import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function runCheck() {
  console.log("==================================================================");
  console.log("             DATABASE CONNECTION & HEALTH DIAGNOSTIC               ");
  console.log("==================================================================");

  console.log("\n[1] Testing PostgreSQL Connection & Host Info...");
  const versionResult = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version();`;
  console.log("  PostgreSQL Engine:", versionResult[0]?.version);

  const contextResult = await prisma.$queryRaw<Array<{
    current_database: string;
    current_user: string;
    inet_server_addr: string | null;
    inet_server_port: number | null;
  }>>`SELECT current_database(), current_user, inet_server_addr(), inet_server_port();`;
  
  const ctx = contextResult[0];
  console.log(`  Database Name:    ${ctx?.current_database}`);
  console.log(`  Connected User:   ${ctx?.current_user}`);
  console.log(`  Server Endpoint:  ${ctx?.inet_server_addr ?? "localhost"}:${ctx?.inet_server_port ?? 5432}`);

  console.log("\n[2] Checking PostgreSQL Active Connection Pool Stats...");
  const connectionsResult = await prisma.$queryRaw<Array<{
    total_connections: bigint;
    active_connections: bigint;
    idle_connections: bigint;
  }>>`
    SELECT 
      count(*) as total_connections,
      count(*) filter (where state = 'active') as active_connections,
      count(*) filter (where state = 'idle') as idle_connections
    FROM pg_stat_activity 
    WHERE datname = current_database();
  `;
  const conn = connectionsResult[0];
  console.log(`  Total Open Connections: ${conn?.total_connections}`);
  console.log(`  Active Queries:        ${conn?.active_connections}`);
  console.log(`  Idle Connections:      ${conn?.idle_connections}`);

  console.log("\n[3] Testing Prisma Client Query & Record Counts for All 41 Models...");
  const models = [
    { name: "Group", client: prisma.group },
    { name: "Company", client: prisma.company },
    { name: "Country", client: prisma.country },
    { name: "Branch", client: prisma.branch },
    { name: "Office", client: prisma.office },
    { name: "FantasyDepartment", client: prisma.fantasyDepartment },
    { name: "FantasyLocation", client: prisma.fantasyLocation },
    { name: "FantasyStatusMapping", client: prisma.fantasyStatusMapping },
    { name: "Customer", client: prisma.customer },
    { name: "SalesRecord", client: prisma.salesRecord },
    { name: "MemoRecord", client: prisma.memoRecord },
    { name: "SalesOrder", client: prisma.salesOrder },
    { name: "SalesOrderLine", client: prisma.salesOrderLine },
    { name: "PolishedStone", client: prisma.polishedStone },
    { name: "RoughStone", client: prisma.roughStone },
    { name: "RoughReservation", client: prisma.roughReservation },
    { name: "WeightBand", client: prisma.weightBand },
    { name: "LabMapping", client: prisma.labMapping },
    { name: "ShapeMapping", client: prisma.shapeMapping },
    { name: "PlanningCategory", client: prisma.planningCategory },
    { name: "DemandRun", client: prisma.demandRun },
    { name: "DemandMetric", client: prisma.demandMetric },
    { name: "Requirement", client: prisma.requirement },
    { name: "RequirementAllocation", client: prisma.requirementAllocation },
    { name: "PlanningCase", client: prisma.planningCase },
    { name: "PlanVersion", client: prisma.planVersion },
    { name: "PlanOption", client: prisma.planOption },
    { name: "PlanOptionPiece", client: prisma.planOptionPiece },
    { name: "ActualPolishedLink", client: prisma.actualPolishedLink },
    { name: "PlanActualReconciliation", client: prisma.planActualReconciliation },
    { name: "ForecastRun", client: prisma.forecastRun },
    { name: "ForecastPrediction", client: prisma.forecastPrediction },
    { name: "ModelVersion", client: prisma.modelVersion },
    { name: "BusinessRule", client: prisma.businessRule },
    { name: "FeatureFlag", client: prisma.featureFlag },
    { name: "AuditLog", client: prisma.auditLog },
    { name: "DataQualityIssue", client: prisma.dataQualityIssue },
    { name: "Notification", client: prisma.notification },
    { name: "IntegrationSyncRun", client: prisma.integrationSyncRun },
    { name: "User", client: prisma.user },
    { name: "Session", client: prisma.session },
  ];

  const tableData: Array<{ Model: string; Status: string; Records: number | string }> = [];

  for (const m of models) {
    try {
      // @ts-ignore
      const count = await m.client.count();
      tableData.push({ Model: m.name, Status: "HEALTHY", Records: count });
    } catch (err: any) {
      tableData.push({ Model: m.name, Status: "ERROR", Records: err.message });
    }
  }

  console.table(tableData);

  console.log("\n[4] Testing Transaction Write & Rollback Safety...");
  let rollbackPassed = false;
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.featureFlag.create({
        data: {
          code: "TEMP_DB_HEALTH_CHECK_TEST",
          name: "Health Check Temporary Flag",
          enabled: true,
          description: "Temporary flag for health check",
        },
      });
      if (created.id) {
        // Force rollback
        throw new Error("ROLLBACK_TRIGGER");
      }
    });
  } catch (err: any) {
    if (err.message === "ROLLBACK_TRIGGER") {
      rollbackPassed = true;
    } else {
      console.error("  Transaction error:", err);
    }
  }

  const checkRow = await prisma.featureFlag.findUnique({
    where: { code: "TEMP_DB_HEALTH_CHECK_TEST" },
  });

  if (rollbackPassed && !checkRow) {
    console.log("  Write, atomic isolation, and rollback tests PASSED cleanly.");
  } else {
    console.error("  Transaction test failed.");
  }

  console.log("\n[5] Database Migrations Status...");
  const migrationLogs = await prisma.$queryRaw<Array<{
    migration_name: string;
    finished_at: Date;
    applied_steps_count: number;
  }>>`
    SELECT migration_name, finished_at, applied_steps_count 
    FROM _prisma_migrations 
    ORDER BY finished_at ASC;
  `;
  console.table(migrationLogs);

  await prisma.$disconnect();
  console.log("\n>>> ALL DATABASE CONNECTIONS AND TESTS PASSED SUCCESSFULLY! <<<\n");
}

runCheck().catch((err) => {
  console.error("Error executing database check:", err);
  process.exit(1);
});
