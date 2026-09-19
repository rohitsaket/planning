// ============================================================================
// SEED SCRIPT — Realistic diamond manufacturing dataset
// Seed: weight bands, lab mappings, shape mappings, groups/companies/countries,
// branches, Fantasy departments/locations/status mappings, customers, sales
// records (90-day window), polished stones, rough stones, requirements,
// planning cases + plan versions + options + pieces, business rules,
// feature flags, forecasts, audit logs, data quality issues, sync runs.
// ============================================================================
import { PrismaClient } from "@prisma/client";
import {
  CONFIRMED_WEIGHT_BANDS,
  CONFIRMED_LAB_MAPPINGS,
  CONFIRMED_SHAPE_MAPPINGS,
  classifyWeightBand,
  normalizeLab,
} from "../src/lib/domain/diamond-rules";

const prisma = new PrismaClient();

// Deterministic pseudo-random for reproducibility
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20251122);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const randDec = (min: number, max: number, decimals = 2) => {
  const factor = Math.pow(10, decimals);
  return Math.round((rand() * (max - min) + min) * factor) / factor;
};

const SHAPES = ["Round", "Oval", "Pear", "Princess", "Cushion", "Emerald", "Marquise", "Radiant", "Asscher", "Heart"];
const COLORS = ["D", "E", "F", "G", "H", "I", "J"];
const CLARITIES = ["IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2"];
const LABS = ["GIA", "GIA-Premium", "GIA-Standard", "Non-Cert", "IGI"];
const TREATMENTS = ["HPHT", "CVD", "NULL"];

const CUSTOMER_NAMES = [
  "Brilliant Heritage NY", "Pacific Diamond Traders", "EuroGem Geneva", "Mumbai Sparkle Co",
  "Antwerp Cut House", "Tokyo Lumière", "Dubai Carat Exchange", "Sao Paulo Pedras",
  "Hong Kong Elite Gems", "Tel Aviv Brilliance", "London Crown Jewels", "Singapore Star"
];
const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "HK", name: "Hong Kong" },
  { code: "CA", name: "Canada" },
  { code: "IN", name: "India" },
  { code: "BE", name: "Belgium" },
  { code: "AE", name: "UAE" },
];
const BRANCHES_BY_COUNTRY: Record<string, string[]> = {
  US: ["New York", "Los Angeles"],
  HK: ["Central HK"],
  CA: ["Toronto"],
  IN: ["Mumbai", "Surat"],
  BE: ["Antwerp"],
  AE: ["Dubai"],
};

const PLANNERS = ["A. Patel", "B. Cohen", "C. Lee", "D. Garcia"];
const APPROVERS = ["M. Tanaka", "R. Smith"];

function dayOffset(daysAgo: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

async function main() {
  console.log("Clearing existing data...");
  // Wipe in dependency-safe order
  const tables = [
    "IntegrationSyncRun", "Notification", "DataQualityIssue", "AuditLog",
    "FeatureFlag", "BusinessRule", "ModelVersion", "ForecastPrediction",
    "ForecastRun", "PlanActualReconciliation", "ActualPolishedLink",
    "PlanOptionPiece", "RequirementAllocation", "PlanOption", "PlanVersion",
    "PlanningCase", "RoughReservation", "Requirement", "DemandMetric",
    "DemandRun", "PlanningCategory", "ShapeMapping", "LabMapping",
    "WeightBand", "RoughStone", "PolishedStone", "SalesOrderLine",
    "SalesOrder", "MemoRecord", "SalesRecord", "Customer",
    "FantasyStatusMapping", "FantasyLocation", "FantasyDepartment",
    "Office", "Branch", "Country", "Company", "Group",
  ];
  for (const t of tables) {
    // @ts-expect-error dynamic model access
    await prisma[t].deleteMany();
  }

  // =========================================================================
  // WEIGHT BANDS
  // =========================================================================
  console.log("Seeding weight bands...");
  for (const wb of CONFIRMED_WEIGHT_BANDS) {
    await prisma.weightBand.create({
      data: {
        code: wb.code,
        label: wb.label,
        minCt: wb.minCt,
        maxCt: wb.maxCt,
        sortOrder: wb.sortOrder,
        active: true,
      },
    });
  }

  // =========================================================================
  // LAB MAPPINGS
  // =========================================================================
  console.log("Seeding lab mappings...");
  for (const lm of CONFIRMED_LAB_MAPPINGS) {
    await prisma.labMapping.create({
      data: { rawLab: lm.raw || "<BLANK>", normalizedLab: lm.normalized, active: true },
    });
  }
  // Add IGI as Unknown → keep raw, but seed mapping to "Other"
  await prisma.labMapping.create({
    data: { rawLab: "IGI", normalizedLab: "Other", active: true },
  });

  // =========================================================================
  // SHAPE MAPPINGS
  // =========================================================================
  console.log("Seeding shape mappings...");
  for (const sm of CONFIRMED_SHAPE_MAPPINGS) {
    await prisma.shapeMapping.create({
      data: { rawShape: sm.raw, normalizedShape: sm.normalized, active: true },
    });
  }

  // =========================================================================
  // ORGANIZATION HIERARCHY
  // =========================================================================
  console.log("Seeding organization hierarchy...");
  const group = await prisma.group.create({
    data: { code: "GRP-01", name: "Fantasy Diamond Holdings" },
  });
  const companies = [
    { code: "FNY", name: "Fantasy NY Inc." },
    { code: "FHK", name: "Fantasy HK Ltd." },
    { code: "FCA", name: "Fantasy Canada Ltd." },
    { code: "FIN", name: "Fantasy India Pvt." },
  ];
  for (const c of companies) {
    await prisma.company.create({
      data: { code: c.code, name: c.name, groupId: group.id },
    });
  }

  // Countries
  const countryByCode: Record<string, string> = {};
  for (const c of COUNTRIES) {
    const companyCode = c.code === "HK" ? "FHK" : c.code === "CA" ? "FCA" : c.code === "IN" ? "FIN" : "FNY";
    const company = await prisma.company.findUnique({ where: { code: companyCode } });
    if (!company) continue;
    const country = await prisma.country.create({
      data: { code: c.code, name: c.name, companyId: company.id },
    });
    countryByCode[c.code] = country.id;
  }

  // Branches & Offices
  const branchByCode: Record<string, string> = {};
  for (const [countryCode, branchNames] of Object.entries(BRANCHES_BY_COUNTRY)) {
    const countryId = countryByCode[countryCode];
    if (!countryId) continue;
    for (const bn of branchNames) {
      const code = `${countryCode}-${bn.replace(/\s/g, "").toUpperCase()}`;
      const branch = await prisma.branch.create({
        data: { code, name: bn, countryId },
      });
      branchByCode[code] = branch.id;
      await prisma.office.create({
        data: { code: `${code}-OFF`, name: `${bn} Main Office`, branchId: branch.id },
      });
    }
  }

  // =========================================================================
  // FANTASY DEPARTMENTS, LOCATIONS, STATUS MAPPINGS
  // =========================================================================
  console.log("Seeding Fantasy departments/locations/status mappings...");
  const deptDefs = [
    { fid: "FDEPT-ASSY", name: "Assortment", country: "IN", branch: "Surat", type: "Assortment" },
    { fid: "FDEPT-MFG", name: "Manufacturing", country: "IN", branch: "Surat", type: "Manufacturing" },
    { fid: "FDEPT-POL", name: "Polishing", country: "IN", branch: "Mumbai", type: "Polishing" },
    { fid: "FDEPT-NY-INV", name: "NY Inventory", country: "US", branch: "New York", type: "Inventory" },
    { fid: "FDEPT-HK-INV", name: "HK Inventory", country: "HK", branch: "Central HK", type: "Inventory" },
    { fid: "FDEPT-CA-INV", name: "CA Inventory", country: "CA", branch: "Toronto", type: "Inventory" },
  ];
  for (const d of deptDefs) {
    await prisma.fantasyDepartment.create({
      data: { fantasyDeptId: d.fid, name: d.name, country: d.country, branch: d.branch, type: d.type },
    });
  }
  const locDefs = [
    { fid: "FLOC-ASSY-01", name: "Assy-Vault-01", deptId: "FDEPT-ASSY", country: "IN", branch: "Surat" },
    { fid: "FLOC-MFG-01", name: "Mfg-Bench-01", deptId: "FDEPT-MFG", country: "IN", branch: "Surat" },
    { fid: "FLOC-POL-01", name: "Pol-Wheel-01", deptId: "FDEPT-POL", country: "IN", branch: "Mumbai" },
    { fid: "FLOC-NY-01", name: "NY-Vault-01", deptId: "FDEPT-NY-INV", country: "US", branch: "New York" },
    { fid: "FLOC-HK-01", name: "HK-Vault-01", deptId: "FDEPT-HK-INV", country: "HK", branch: "Central HK" },
    { fid: "FLOC-CA-01", name: "CA-Vault-01", deptId: "FDEPT-CA-INV", country: "CA", branch: "Toronto" },
  ];
  for (const l of locDefs) {
    const dept = await prisma.fantasyDepartment.findUnique({ where: { fantasyDeptId: l.deptId } });
    await prisma.fantasyLocation.create({
      data: {
        fantasyLocId: l.fid,
        name: l.name,
        departmentId: dept?.id,
        country: l.country,
        branch: l.branch,
      },
    });
  }
  const statusMappings = [
    { fs: "AVAILABLE", pc: "PHYSICAL", ca: true },
    { fs: "PLANNING_AVAILABLE", pc: "PLANNING_AVAILABLE", ca: true },
    { fs: "RESERVED", pc: "RESERVED", ca: false },
    { fs: "HOLD", pc: "HOLD", ca: false },
    { fs: "TRANSFER", pc: "TRANSFER", ca: false },
    { fs: "MEMO_OUT", pc: "MEMO", ca: false },
    { fs: "QC_HOLD", pc: "HOLD", ca: false },
    { fs: "OTHER", pc: "OTHER", ca: false },
  ];
  for (const sm of statusMappings) {
    await prisma.fantasyStatusMapping.create({
      data: { fantasyStatus: sm.fs, planningClass: sm.pc, countsAvailable: sm.ca },
    });
  }

  // =========================================================================
  // CUSTOMERS
  // =========================================================================
  console.log("Seeding customers...");
  const customerIds: string[] = [];
  for (let i = 0; i < CUSTOMER_NAMES.length; i++) {
    const name = CUSTOMER_NAMES[i];
    const country = pick(COUNTRIES);
    const branch = pick(BRANCHES_BY_COUNTRY[country.code] || ["Main"]);
    const priority = pick(["Strategic", "Key", "Standard", "New", "Internal"]);
    const c = await prisma.customer.create({
      data: {
        customerCode: `CUST-${String(i + 1).padStart(4, "0")}`,
        name,
        country: country.code,
        branch,
        accountOwner: pick(["S. Adler", "T. Becker", "V. Nakamura", "L. Ferreira"]),
        businessPriority: priority,
        priorityReason: priority === "Strategic" ? "Top-10 revenue contributor (manual classification)" :
                        priority === "Key" ? "Recurring order history > 24 months" :
                        priority === "New" ? "Onboarded within last 90 days" :
                        priority === "Internal" ? "Intra-group transfer entity" :
                        "Default classification",
      },
    });
    customerIds.push(c.id);
  }

  // =========================================================================
  // SALES RECORDS — invoice stones within 90-day window + some outside
  // =========================================================================
  console.log("Seeding sales records (90-day invoice window)...");
  let salesLotCounter = 1;
  const salesRecords: { category: string; customerId: string; country: string; branch: string; docDate: Date; weight: number; saleTotal: number }[] = [];
  for (let i = 0; i < 420; i++) {
    // ~70% within 90-day window as invoices
    const withinWindow = rand() < 0.7;
    const daysAgo = withinWindow ? randInt(0, 89) : randInt(91, 365);
    const status = withinWindow ? "Invoice" : pick(["Memo", "Stock"]);
    const shape = pick(SHAPES);
    // Bias weights toward 1.00-3.00 ct
    const weightBandsActive = [randDec(1.0, 1.09, 2), randDec(1.1, 1.49, 2), randDec(1.5, 1.59, 2), randDec(1.7, 1.99, 2), randDec(2.0, 2.49, 2), randDec(2.5, 2.99, 2), randDec(3.0, 3.49, 2), randDec(3.5, 4.99, 2), randDec(5.0, 7.99, 2)];
    const weight = pick(weightBandsActive);
    const lab = pick(LABS);
    const color = pick(COLORS);
    const clarity = pick(CLARITIES);
    const treatment = pick(TREATMENTS);
    const customer = pick(customerIds);
    const country = pick(COUNTRIES);
    const branch = pick(BRANCHES_BY_COUNTRY[country.code] || ["Main"]);
    const saleTotal = weight * randDec(2500, 18000, 2);
    const band = classifyWeightBand(weight);
    const labN = normalizeLab(lab);
    await prisma.salesRecord.create({
      data: {
        lotId: `LOT-${String(salesLotCounter++).padStart(6, "0")}`,
        docDate: dayOffset(daysAgo),
        lotStatusDb: status,
        qty: 1,
        shape,
        weight,
        weightBandId: band ? (await prisma.weightBand.findUnique({ where: { code: band.code } }))?.id : null,
        color,
        clarity,
        labRaw: lab,
        labNormalized: labN.normalized,
        certificate: lab === "Non-Cert" ? null : `CERT-${randInt(100000, 999999)}`,
        treatment: treatment === "NULL" ? null : treatment,
        saleTotalUsd: saleTotal,
        customerId: customer,
        country: country.code,
        branch,
        salesperson: pick(["S. Adler", "T. Becker", "V. Nakamura", "L. Ferreira"]),
      },
    });
    if (status === "Invoice" && withinWindow) {
      salesRecords.push({ category: `${labN.normalized}|${shape}|${band?.label ?? "Unknown"}`, customerId: customer, country: country.code, branch, docDate: dayOffset(daysAgo), weight, saleTotal });
    }
  }

  // =========================================================================
  // POLISHED STONES (Fantasy authoritative polished stock)
  // =========================================================================
  console.log("Seeding polished stones...");
  let polishedLotCounter = 1;
  for (let i = 0; i < 220; i++) {
    const shape = pick(SHAPES);
    const weight = pick([randDec(1.0, 1.09, 2), randDec(1.1, 1.49, 2), randDec(1.5, 1.59, 2), randDec(1.7, 1.99, 2), randDec(2.0, 2.49, 2), randDec(2.5, 2.99, 2), randDec(3.0, 3.49, 2)]);
    const lab = pick(LABS);
    const labN = normalizeLab(lab);
    const band = classifyWeightBand(weight);
    const country = pick(COUNTRIES);
    const branch = pick(BRANCHES_BY_COUNTRY[country.code] || ["Main"]);
    const fantasyStatus = pick(["AVAILABLE", "PLANNING_AVAILABLE", "RESERVED", "HOLD", "TRANSFER", "MEMO_OUT", "QC_HOLD"]);
    const statusMap = await prisma.fantasyStatusMapping.findUnique({ where: { fantasyStatus } });
    await prisma.polishedStone.create({
      data: {
        fantasyLotId: `FPL-${String(polishedLotCounter++).padStart(6, "0")}`,
        fantasyDepartmentId: pick(["FDEPT-NY-INV", "FDEPT-HK-INV", "FDEPT-CA-INV"]),
        fantasyLocationId: pick(["FLOC-NY-01", "FLOC-HK-01", "FLOC-CA-01"]),
        country: country.code,
        branch,
        fantasyStatus,
        labRaw: lab,
        labNormalized: labN.normalized,
        shape,
        shapeNormalized: shape,
        weight,
        weightBandId: band ? (await prisma.weightBand.findUnique({ where: { code: band.code } }))?.id : null,
        color: pick(COLORS),
        clarity: pick(CLARITIES),
        certificate: lab === "Non-Cert" ? null : `CERT-${randInt(100000, 999999)}`,
        treatment: pick(["HPHT", "CVD", null]),
        planningClass: statusMap?.planningClass ?? "OTHER",
        lastUpdated: dayOffset(randInt(0, 60)),
      },
    });
  }

  // =========================================================================
  // ROUGH STONES (Fantasy authoritative rough stock)
  // =========================================================================
  console.log("Seeding rough stones...");
  let roughCounter = 1;
  const roughIds: string[] = [];
  for (let i = 0; i < 60; i++) {
    const stoneType = rand() < 0.35 ? "BLUE" : "WHITE";
    const kapan = stoneType === "BLUE" ? `${randInt(100, 999)}D` : `${randInt(1000, 9999)}`;
    const packet = stoneType === "BLUE" ? String(randInt(100, 999)) : String(randInt(1, 999)).padStart(3, "0");
    const signer = pick(["pv", "HA", "AB", "KX", "ZQ", "RT"]);
    const stoneName = stoneType === "BLUE" ? `${kapan}-${packet}_E+${signer}` : `${kapan}-${packet} ${signer}`;
    const roughWeight = randDec(8, 60, 2);
    const country = pick(["IN", "BE"]);
    const branch = country === "IN" ? "Surat" : "Antwerp";
    const c = await prisma.roughStone.create({
      data: {
        fantasyRoughId: `FRS-${String(roughCounter++).padStart(6, "0")}`,
        kapan,
        packet,
        stoneName,
        signer,
        stoneType,
        roughWeight,
        country,
        branch,
        fantasyDepartmentId: "FDEPT-ASSY",
        fantasyLocationId: "FLOC-ASSY-01",
        fantasyStatus: pick(["AVAILABLE", "PLANNING_AVAILABLE", "UNDER_PLANNING", "RESERVED"]),
        planningEligible: rand() < 0.8,
        planningStatus: pick(["AVAILABLE", "AVAILABLE", "AVAILABLE", "SOFT_RESERVED", "UNDER_PLANNING"]),
        lastMovement: dayOffset(randInt(0, 90)),
      },
    });
    roughIds.push(c.id);
  }

  // =========================================================================
  // REQUIREMENTS — derived from sales records grouping (90-day invoice counts)
  // =========================================================================
  console.log("Seeding requirements...");
  // Build category aggregates
  const catAgg = new Map<string, { count: number; customers: Set<string>; countries: Set<string> }>();
  for (const r of salesRecords) {
    const agg = catAgg.get(r.category) ?? { count: 0, customers: new Set(), countries: new Set() };
    agg.count += 1;
    agg.customers.add(r.customerId);
    agg.countries.add(r.country);
    catAgg.set(r.category, agg);
  }
  let reqCounter = 1;
  for (const [cat, agg] of catAgg.entries()) {
    const [lab, shape, bandLabel] = cat.split("|");
    const band = await prisma.weightBand.findFirst({ where: { label: bandLabel } });
    const sales90d = agg.count;
    const monthlyAvg = sales90d / 3;
    const unroundedTarget = monthlyAvg * 2;
    const roundedTarget = Math.floor(unroundedTarget + 0.5 + 1e-9);
    // Approximate available stock from polished stones for this category
    const available = await prisma.polishedStone.count({
      where: { labNormalized: lab, shape, weightBand: { label: bandLabel }, planningClass: { in: ["PHYSICAL", "PLANNING_AVAILABLE"] } },
    });
    const physicalShortage = Math.max(0, roundedTarget - available);
    const excess = Math.max(0, available - roundedTarget);
    const wipCoverage = randInt(0, Math.floor(physicalShortage * 0.4));
    const pipeline = Math.max(0, physicalShortage - wipCoverage);
    const planCov = randInt(0, Math.floor(pipeline * 0.6));
    const remaining = Math.max(0, pipeline - planCov);
    const forecast = Math.round(sales90d * 0.15);
    const reqType = pick(["STOCK_REPLENISHMENT", "CUSTOMER_ORDER", "BACKORDER", "SPECIAL_REQUIREMENT", "MANUAL_APPROVED"]);
    const custPriority = pick(["Strategic", "Key", "Standard", "New", "Internal"]);
    const daysOverdue = rand() < 0.25 ? randInt(1, 30) : 0;
    // Multi-factor priority classification (shortage + overdue + customer priority + type)
    // NOTE: Customer-priority weighting is OPEN rule BR-CUST-PRI-001; this seed classification
    // is for realistic demo data only — production priority is set by an approved business rule.
    let reqPriority: string;
    const reasons: string[] = [];
    if (physicalShortage >= 8 || (physicalShortage >= 4 && daysOverdue > 0)) {
      reqPriority = "CRITICAL";
      reasons.push(`Physical shortage ${physicalShortage} pcs`);
      if (daysOverdue > 0) reasons.push(`${daysOverdue}d overdue`);
    } else if (physicalShortage >= 4 || (physicalShortage >= 2 && (daysOverdue > 0 || custPriority === "Strategic"))) {
      reqPriority = "HIGH";
      reasons.push(`Physical shortage ${physicalShortage} pcs`);
      if (custPriority === "Strategic") reasons.push("Strategic customer");
    } else if (physicalShortage >= 1) {
      reqPriority = "NORMAL";
      reasons.push(`Physical shortage ${physicalShortage} pcs`);
    } else {
      reqPriority = "LOW";
      reasons.push("No physical shortage (FULFILLED)");
    }
    if (reqType === "BACKORDER") reasons.push("Backorder demand");
    if (reqType === "SPECIAL_REQUIREMENT") reasons.push("Special requirement");
    const orderPriority = daysOverdue > 14 ? "CRITICAL" : daysOverdue > 0 ? "HIGH" : physicalShortage >= 4 ? "NORMAL" : "LOW";
    const country = pick(Array.from(agg.countries));
    const branch = pick(BRANCHES_BY_COUNTRY[country] || ["Main"]);
    const customerName = "Multiple";
    await prisma.requirement.create({
      data: {
        requirementCode: `REQ-${String(reqCounter++).padStart(5, "0")}`,
        type: reqType,
        status: physicalShortage === 0 ? "FULFILLED" : planCov > 0 && remaining === 0 ? "FULLY_PLANNED" : planCov > 0 ? "PARTIALLY_COVERED" : "ACTIVE",
        customerName,
        groupCode: "GRP-01",
        companyCode: country === "HK" ? "FHK" : country === "CA" ? "FCA" : country === "IN" ? "FIN" : "FNY",
        country,
        branch,
        labNormalized: lab,
        shape,
        weightBandId: band?.id,
        requiredQty: roundedTarget,
        physicalStockQty: available,
        planningAvailableQty: available,
        memoQty: 0,
        transferCoverage: 0,
        wipCoverage,
        approvedPlanCoverage: planCov,
        actualCoverage: 0,
        remainingUnplanned: remaining,
        forecastQty: forecast,
        requiredBy: dayOffset(randInt(-30, 60)),
        ageDays: randInt(0, 120),
        daysRemaining: randInt(0, 60),
        daysOverdue,
        customerPriority: custPriority,
        orderPriority,
        requirementPriority: reqPriority,
        priorityReason: reasons.join("; "),
        calculationRunId: "SEED-RUN-001",
        businessRuleVersion: "DEMAND-V1",
        sourceRecords: JSON.stringify({ sales90d, monthlyAvg, unroundedTarget, roundedTarget, available, physicalShortage, excess }),
        createdBy: "system-seed",
        updatedBy: "system-seed",
      },
    });
  }

  // Add a few explicitly CRITICAL aggregate requirements (top customer orders with large qty)
  console.log("Seeding critical aggregate requirements...");
  const criticalReqs = [
    { type: "CUSTOMER_ORDER", customer: "Brilliant Heritage NY", country: "US", branch: "New York", lab: "GIA", shape: "Round", bandLabel: "1.70-1.99", qty: 12, daysOverdue: 5, custPri: "Strategic", reason: "Strategic customer order; 5d overdue; 12 pcs required" },
    { type: "BACKORDER", customer: "Pacific Diamond Traders", country: "HK", branch: "Central HK", lab: "GIA", shape: "Oval", bandLabel: "2.10-2.49", qty: 9, daysOverdue: 12, custPri: "Key", reason: "Backorder 12d overdue; 9 pcs committed" },
    { type: "CUSTOMER_ORDER", customer: "EuroGem Geneva", country: "BE", branch: "Antwerp", lab: "GIA", shape: "Emerald", bandLabel: "3.00-3.09", qty: 8, daysOverdue: 0, custPri: "Strategic", reason: "Strategic customer order; 8 pcs; near-term due" },
    { type: "SPECIAL_REQUIREMENT", customer: "Tokyo Lumière", country: "HK", branch: "Central HK", lab: "GIA", shape: "Pear", bandLabel: "1.50-1.59", qty: 10, daysOverdue: 3, custPri: "Key", reason: "Special program requirement; 3d overdue" },
    { type: "BACKORDER", customer: "Mumbai Sparkle Co", country: "IN", branch: "Mumbai", lab: "Non-Cert", shape: "Princess", bandLabel: "1.00-1.09", qty: 14, daysOverdue: 21, custPri: "Standard", reason: "Backorder 21d overdue; 14 pcs" },
    { type: "CUSTOMER_ORDER", customer: "Antwerp Cut House", country: "BE", branch: "Antwerp", lab: "GIA", shape: "Cushion", bandLabel: "2.50-2.59", qty: 7, daysOverdue: 0, custPri: "Strategic", reason: "Strategic customer; 7 pcs; immediate requirement" },
  ];
  for (const cr of criticalReqs) {
    const band = await prisma.weightBand.findFirst({ where: { label: cr.bandLabel } });
    await prisma.requirement.create({
      data: {
        requirementCode: `REQ-${String(reqCounter++).padStart(5, "0")}`,
        type: cr.type,
        status: "ACTIVE",
        customerName: cr.customer,
        groupCode: "GRP-01",
        companyCode: cr.country === "HK" ? "FHK" : cr.country === "CA" ? "FCA" : cr.country === "IN" ? "FIN" : "FNY",
        country: cr.country,
        branch: cr.branch,
        labNormalized: cr.lab,
        shape: cr.shape,
        weightBandId: band?.id,
        requiredQty: cr.qty,
        physicalStockQty: 0,
        planningAvailableQty: 0,
        memoQty: 0,
        transferCoverage: 0,
        wipCoverage: 0,
        approvedPlanCoverage: 0,
        actualCoverage: 0,
        remainingUnplanned: cr.qty,
        forecastQty: 0,
        requiredBy: dayOffset(cr.daysOverdue > 0 ? -cr.daysOverdue : randInt(7, 30)),
        ageDays: randInt(10, 90),
        daysRemaining: cr.daysOverdue > 0 ? 0 : randInt(7, 30),
        daysOverdue: cr.daysOverdue,
        customerPriority: cr.custPri,
        orderPriority: cr.daysOverdue > 7 ? "CRITICAL" : "HIGH",
        requirementPriority: "CRITICAL",
        priorityReason: cr.reason,
        calculationRunId: "SEED-RUN-001",
        businessRuleVersion: "DEMAND-V1",
        sourceRecords: JSON.stringify({ aggregate: true, customer: cr.customer, type: cr.type, manualClassification: true }),
        createdBy: "system-seed",
        updatedBy: "system-seed",
      },
    });
  }

  // Add a few HIGH priority requirements
  const highReqs = [
    { type: "CUSTOMER_ORDER", customer: "Dubai Carat Exchange", country: "AE", branch: "Dubai", lab: "GIA", shape: "Radiant", bandLabel: "1.10-1.49", qty: 6, custPri: "Key" },
    { type: "STOCK_REPLENISHMENT", customer: "Multiple", country: "US", branch: "New York", lab: "GIA", shape: "Round", bandLabel: "1.00-1.09", qty: 5, custPri: "Standard" },
    { type: "CUSTOMER_ORDER", customer: "Singapore Star", country: "HK", branch: "Central HK", lab: "GIA", shape: "Marquise", bandLabel: "1.60-1.69", qty: 4, custPri: "Key" },
    { type: "BACKORDER", customer: "London Crown Jewels", country: "BE", branch: "Antwerp", lab: "GIA", shape: "Asscher", bandLabel: "2.00-2.09", qty: 5, custPri: "Standard" },
  ];
  for (const hr of highReqs) {
    const band = await prisma.weightBand.findFirst({ where: { label: hr.bandLabel } });
    await prisma.requirement.create({
      data: {
        requirementCode: `REQ-${String(reqCounter++).padStart(5, "0")}`,
        type: hr.type,
        status: "ACTIVE",
        customerName: hr.customer,
        groupCode: "GRP-01",
        companyCode: hr.country === "HK" ? "FHK" : hr.country === "CA" ? "FCA" : hr.country === "IN" ? "FIN" : "FNY",
        country: hr.country,
        branch: hr.branch,
        labNormalized: hr.lab,
        shape: hr.shape,
        weightBandId: band?.id,
        requiredQty: hr.qty,
        physicalStockQty: 0,
        planningAvailableQty: 0,
        remainingUnplanned: hr.qty,
        requiredBy: dayOffset(randInt(0, 14)),
        ageDays: randInt(5, 60),
        daysRemaining: randInt(0, 14),
        daysOverdue: rand() < 0.5 ? randInt(1, 7) : 0,
        customerPriority: hr.custPri,
        orderPriority: "HIGH",
        requirementPriority: "HIGH",
        priorityReason: `Physical shortage ${hr.qty} pcs; ${hr.type} for ${hr.lab} ${hr.shape} ${hr.bandLabel}`,
        calculationRunId: "SEED-RUN-001",
        businessRuleVersion: "DEMAND-V1",
        sourceRecords: JSON.stringify({ aggregate: true, type: hr.type }),
        createdBy: "system-seed",
        updatedBy: "system-seed",
      },
    });
  }

  // =========================================================================
  // PLANNING CASES + VERSIONS + OPTIONS + PIECES
  // =========================================================================
  console.log("Seeding planning cases / plan versions / options / pieces...");
  let caseCounter = 1;
  let optCounter = 1;
  let pieceCounter = 1;
  for (let i = 0; i < 18; i++) {
    const rough = await prisma.roughStone.findUnique({ where: { id: roughIds[i] } });
    if (!rough) continue;
    const stoneType = rough.stoneType;
    const mainPlanLimit = stoneType === "BLUE" ? 17 : 32;
    const planCount = randInt(3, Math.min(mainPlanLimit, 8));
    const status = pick(["DRAFT", "READY_FOR_REVIEW", "SELECTED", "APPROVAL_PENDING", "APPROVED", "RELEASED_TO_MANUFACTURING", "REJECTED", "REPLAN_REQUIRED"]);
    const caseRecord = await prisma.planningCase.create({
      data: {
        caseCode: `PC-${String(caseCounter++).padStart(5, "0")}`,
        roughId: rough.id,
        stoneName: rough.stoneName,
        kapan: rough.kapan,
        packet: rough.packet,
        originalRoughWeight: rough.roughWeight,
        stoneType,
        planner: pick(PLANNERS),
        planningDate: dayOffset(randInt(0, 30)),
        status,
        currentVersion: 1,
        sourceFile: `workbook-${stoneType.toLowerCase()}-${caseCounter}.xlsx`,
        approvedBy: status === "APPROVED" || status === "RELEASED_TO_MANUFACTURING" ? pick(APPROVERS) : null,
        approvedAt: status === "APPROVED" || status === "RELEASED_TO_MANUFACTURING" ? dayOffset(randInt(0, 20)) : null,
        approvalComment: status === "REJECTED" ? "Yield too low vs requirement coverage" : status === "APPROVED" ? "Approved - balanced yield + coverage" : null,
      },
    });
    const version = await prisma.planVersion.create({
      data: {
        planningCaseId: caseRecord.id,
        versionNumber: 1,
        reason: "Initial plan",
        status,
        createdBy: pick(PLANNERS),
      },
    });
    let selectedOptionId: string | null = null;
    for (let p = 1; p <= planCount; p++) {
      const expectedPieces = randInt(1, 4);
      const expectedWeight = randDec(0.6, 3.5, 3) * expectedPieces;
      const yieldPct = Math.round((expectedWeight / Number(rough.roughWeight)) * 10000) / 100;
      const matchingReq = randInt(0, expectedPieces);
      const coverage = Math.min(matchingReq, expectedPieces);
      const coveragePct = expectedPieces > 0 ? Math.round((coverage / expectedPieces) * 10000) / 100 : 0;
      const isSelected = (status === "SELECTED" || status === "APPROVAL_PENDING" || status === "APPROVED" || status === "RELEASED_TO_MANUFACTURING") && p === 1;
      const approvalStatus = status === "APPROVED" || status === "RELEASED_TO_MANUFACTURING" ? "APPROVED" : status === "REJECTED" ? "REJECTED" : status === "APPROVAL_PENDING" ? "APPROVAL_PENDING" : "DRAFT";
      const opt = await prisma.planOption.create({
        data: {
          optionCode: `OPT-${String(optCounter++).padStart(6, "0")}`,
          versionId: version.id,
          optionNumber: p,
          expectedPieces,
          expectedTotalWeight: expectedWeight,
          yieldPct,
          matchingRequiredPieces: matchingReq,
          requirementCoverage: coverage,
          coveragePct,
          nonRequiredPieces: Math.max(0, expectedPieces - matchingReq),
          expectedColor: pick(COLORS),
          expectedClarity: pick(CLARITIES),
          certificationIntent: pick(["GIA", "Non-Cert", "Other", "Undecided"]),
          potentialExcess: Math.max(0, expectedPieces - matchingReq),
          validationWarnings: rand() < 0.2 ? "Unknown shape detected in row 3" : null,
          selected: isSelected,
          selectedBy: isSelected ? pick(PLANNERS) : null,
          selectedAt: isSelected ? dayOffset(randInt(0, 10)) : null,
          approvalStatus,
          approvedBy: approvalStatus === "APPROVED" ? pick(APPROVERS) : null,
          approvedAt: approvalStatus === "APPROVED" ? dayOffset(randInt(0, 10)) : null,
        },
      });
      if (isSelected) selectedOptionId = opt.id;
      // Pieces
      for (let pi = 0; pi < expectedPieces; pi++) {
        const shape = pick(SHAPES);
        const w = randDec(0.6, 3.5, 3);
        const band = classifyWeightBand(w);
        const labN = pick(["GIA", "Non-Cert"]);
        await prisma.planOptionPiece.create({
          data: {
            pieceCode: `PP-${String(pieceCounter++).padStart(6, "0")}`,
            planOptionId: opt.id,
            sequence: pi + 1,
            expectedShape: shape,
            expectedWeight: w,
            expectedColor: pick(COLORS),
            expectedClarity: pick(CLARITIES),
            expectedCategory: band ? `${labN}|${shape}|${band.label}` : null,
            certificationIntent: pick(["GIA", "Non-Cert", "Undecided"]),
          },
        });
      }
    }
    await prisma.planningCase.update({
      where: { id: caseRecord.id },
      data: { selectedOptionId },
    });
    // Rough reservation if released/approved
    if (status === "APPROVED" || status === "RELEASED_TO_MANUFACTURING") {
      await prisma.roughReservation.create({
        data: {
          roughId: rough.id,
          planningCaseId: caseRecord.id,
          status: status === "RELEASED_TO_MANUFACTURING" ? "RELEASED_TO_MANUFACTURING" : "RESERVED",
          reservedBy: pick(PLANNERS),
          reservedAt: dayOffset(randInt(0, 15)),
        },
      });
    }
  }

  // =========================================================================
  // SALES ORDERS
  // =========================================================================
  console.log("Seeding sales orders...");
  for (let i = 0; i < 25; i++) {
    const custId = pick(customerIds);
    const cust = await prisma.customer.findUnique({ where: { id: custId } });
    if (!cust) continue;
    const lineCount = randInt(1, 4);
    const orderDate = dayOffset(randInt(0, 60));
    const requiredDate = dayOffset(randInt(-10, 45));
    const priority = requiredDate.getTime() < Date.now() ? "CRITICAL" : pick(["HIGH", "NORMAL", "NORMAL", "LOW", "WATCH"]);
    const so = await prisma.salesOrder.create({
      data: {
        orderNumber: `SO-${String(2000 + i).padStart(5, "0")}`,
        customerId: custId,
        orderDate,
        requiredDate,
        promisedDate: dayOffset(randInt(5, 50)),
        branch: cust.branch,
        country: cust.country,
        status: pick(["OPEN", "PARTIAL", "OPEN", "OPEN"]),
        priority,
        priorityReason: priority === "CRITICAL" ? "Required date already passed" : priority === "HIGH" ? "Strategic customer + near-term due" : "Standard lead time",
        notes: pick(["Customer program stock", "Memo conversion expected", "Repeat order", "New product introduction"]),
      },
    });
    for (let l = 0; l < lineCount; l++) {
      const shape = pick(SHAPES);
      const weight = randDec(1.0, 3.5, 2);
      const band = classifyWeightBand(weight);
      const qty = randInt(1, 8);
      const allocated = randInt(0, qty);
      await prisma.salesOrderLine.create({
        data: {
          orderId: so.id,
          lineNo: l + 1,
          lab: pick(["GIA", "Non-Cert"]),
          shape,
          weight,
          weightBandId: band ? (await prisma.weightBand.findUnique({ where: { code: band.code } }))?.id : null,
          color: pick(COLORS),
          clarity: pick(CLARITIES),
          qtyOrdered: qty,
          qtyAllocated: allocated,
          qtyDelivered: randInt(0, allocated),
          qtyOutstanding: qty - allocated,
          backorderQty: rand() < 0.2 ? randInt(1, 3) : 0,
          specialRequirement: rand() < 0.15 ? "Customer-specific brand inscription" : null,
        },
      });
    }
  }

  // =========================================================================
  // MEMO RECORDS
  // =========================================================================
  console.log("Seeding memo records...");
  let memoLotCounter = 1;
  for (let i = 0; i < 35; i++) {
    const custId = pick(customerIds);
    const cust = await prisma.customer.findUnique({ where: { id: custId } });
    if (!cust) continue;
    const memoDate = dayOffset(randInt(0, 120));
    const ageDays = Math.floor((Date.now() - memoDate.getTime()) / (1000 * 60 * 60 * 24));
    await prisma.memoRecord.create({
      data: {
        lotId: `MEMO-${String(memoLotCounter++).padStart(6, "0")}`,
        memoDate,
        customerId: custId,
        country: cust.country,
        branch: cust.branch,
        shape: pick(SHAPES),
        weight: randDec(1.0, 3.5, 2),
        labNormalized: pick(["GIA", "Non-Cert"]),
        color: pick(COLORS),
        clarity: pick(CLARITIES),
        treatment: pick(["HPHT", "CVD", null]),
        memoValueUsd: randDec(3000, 45000, 2),
        status: pick(["OPEN", "OPEN", "OPEN", "RETURNED", "INVOICED"]),
        memoAgeDays: ageDays,
      },
    });
  }

  // =========================================================================
  // DEMAND RUN + METRICS (latest run)
  // =========================================================================
  console.log("Seeding demand run + metrics...");
  const demandRun = await prisma.demandRun.create({
    data: {
      runDate: new Date(),
      windowDays: 90,
      ruleVersion: "DEMAND-V1",
      status: "COMPLETED",
      totalShortage: 0,
      totalExcess: 0,
    },
  });
  // Aggregate metrics from sales + polished
  const metricAgg = new Map<string, { sales90d: number; available: number; memo: number; wip: number; planCov: number; forecast: number }>();
  for (const r of salesRecords) {
    const m = metricAgg.get(r.category) ?? { sales90d: 0, available: 0, memo: 0, wip: 0, planCov: 0, forecast: 0 };
    m.sales90d += 1;
    metricAgg.set(r.category, m);
  }
  let totalShortage = 0;
  let totalExcess = 0;
  for (const [cat, m] of metricAgg.entries()) {
    const [lab, shape, bandLabel] = cat.split("|");
    const available = await prisma.polishedStone.count({
      where: { labNormalized: lab, shape, weightBand: { label: bandLabel }, planningClass: { in: ["PHYSICAL", "PLANNING_AVAILABLE"] } },
    });
    const monthlyAvg = m.sales90d / 3;
    const unroundedTarget = monthlyAvg * 2;
    const roundedTarget = Math.floor(unroundedTarget + 0.5 + 1e-9);
    const shortage = Math.max(0, roundedTarget - available);
    const excess = Math.max(0, available - roundedTarget);
    const wip = randInt(0, Math.floor(shortage * 0.4));
    const planCov = randInt(0, Math.floor(Math.max(0, shortage - wip) * 0.6));
    const pipeline = Math.max(0, shortage - wip);
    const remaining = Math.max(0, pipeline - planCov);
    totalShortage += shortage;
    totalExcess += excess;
    await prisma.demandMetric.create({
      data: {
        runId: demandRun.id,
        planningCategory: cat,
        sales90d: m.sales90d,
        monthlyAverage: monthlyAvg,
        unroundedTarget,
        roundedTarget,
        availableStock: available,
        memoQty: 0,
        physicalShortage: shortage,
        excessStock: excess,
        wipCoverage: wip,
        pipelineNeed: pipeline,
        approvedPlanCoverage: planCov,
        remainingUnplanned: remaining,
        forecastSignal: Math.round(m.sales90d * 0.15),
      },
    });
  }
  await prisma.demandRun.update({
    where: { id: demandRun.id },
    data: { totalShortage, totalExcess },
  });

  // =========================================================================
  // FORECASTS
  // =========================================================================
  console.log("Seeding forecasts...");
  const modelVer = await prisma.modelVersion.create({
    data: {
      modelName: "Sales-Holt-Winters-V1",
      version: "1.0.0",
      algorithm: "Holt-Winters Exponential Smoothing",
      trainingPeriod: "2023-01-01..2025-09-01",
      validationPeriod: "2025-10-01..2025-11-15",
      metricsJson: JSON.stringify({ MAE: 1.84, WAPE: 0.21, RMSE: 2.43, BIAS: 0.07 }),
      publishedBy: "D. Garcia",
      publishedAt: new Date(),
      status: "PUBLISHED",
    },
  });
  const forecastRun = await prisma.forecastRun.create({
    data: {
      modelVersion: "1.0.0",
      horizon30d: 0,
      horizon60d: 0,
      horizon90d: 0,
      metricsJson: JSON.stringify({ modelId: modelVer.id, algo: "Holt-Winters" }),
      status: "COMPLETED",
    },
  });
  let h30 = 0, h60 = 0, h90 = 0;
  for (const [cat] of metricAgg.entries()) {
    const [lab, shape, bandLabel] = cat.split("|");
    const sales90d = metricAgg.get(cat)!.sales90d;
    const p30 = Math.round(sales90d * 0.4 + randInt(-2, 3));
    const p60 = Math.round(sales90d * 0.8 + randInt(-3, 4));
    const p90 = Math.round(sales90d + randInt(-4, 5));
    h30 += p30; h60 += p60; h90 += p90;
    const available = await prisma.polishedStone.count({
      where: { labNormalized: lab, shape, weightBand: { label: bandLabel }, planningClass: { in: ["PHYSICAL", "PLANNING_AVAILABLE"] } },
    });
    const risk = available - p30 <= 0 ? "CRITICAL" : available - (p30 + p90) / 2 <= 0 ? "HIGH" : available - p90 <= 0 ? "MEDIUM" : "LOW";
    await prisma.forecastPrediction.create({
      data: {
        runId: forecastRun.id,
        category: cat,
        prediction30d: Math.max(0, p30),
        prediction60d: Math.max(0, p60),
        prediction90d: Math.max(0, p90),
        confidence: randDec(0.55, 0.92, 2),
        trend: pick(["Strong Growth", "Growth", "Stable", "Declining", "New Demand", "Dormant"]),
        stockoutRisk: risk,
        stockoutDate: risk === "CRITICAL" ? dayOffset(randInt(5, 25)) : risk === "HIGH" ? dayOffset(randInt(25, 50)) : null,
      },
    });
  }
  await prisma.forecastRun.update({
    where: { id: forecastRun.id },
    data: { horizon30d: h30, horizon60d: h60, horizon90d: h90 },
  });

  // =========================================================================
  // BUSINESS RULES, FEATURE FLAGS
  // =========================================================================
  console.log("Seeding business rules + feature flags...");
  const rules = [
    { ruleId: "BR-DEMAND-001", domain: "DEMAND", name: "90-day rolling invoice window", version: "1.0", status: "CONFIRMED", config: { windowDays: 90, lotStatus: "Invoice", todayIncluded: true }, notes: "Confirmed production rule." },
    { ruleId: "BR-DEMAND-002", domain: "DEMAND", name: "Monthly Average", version: "1.0", status: "CONFIRMED", config: { formula: "sales90d / 3" } },
    { ruleId: "BR-DEMAND-003", domain: "DEMAND", name: "Target Stock", version: "1.0", status: "CONFIRMED", config: { formula: "round_half_up(monthlyAvg * 2)", roundingBoundary: 0.5, roundsUp: true } },
    { ruleId: "BR-MEMO-001", domain: "MEMO", name: "Memo Excluded From Shortage", version: "1.0", status: "CONFIRMED", config: { memoReducesShortage: false }, notes: "Memo is separate decision context." },
    { ruleId: "BR-LAB-001", domain: "LAB", name: "GIA Normalization", version: "1.0", status: "CONFIRMED", config: { gia: "GIA", giaPremium: "GIA", giaStandard: "GIA", blank: "Non-Cert" } },
    { ruleId: "BR-WB-001", domain: "WEIGHT_BAND", name: "Confirmed Analytical Bands", version: "1.0", status: "CONFIRMED", config: { startsAt: 1.0, bands: CONFIRMED_WEIGHT_BANDS.length, excludes: ["0.90-0.99"] } },
    { ruleId: "BR-SHAPE-001", domain: "SHAPE", name: "Shape Master Mapping", version: "1.0", status: "CONFIRMED", config: { mappingCount: CONFIRMED_SHAPE_MAPPINGS.length } },
    { ruleId: "BR-EM-001", domain: "SHAPE", name: "EMERALD 5STEP Ratio Rule", version: "1.0", status: "CONFIRMED", config: { asscher: "1.00-1.03", emerald: ">= 1.40", blocked: "1.04-1.39 and below 1.00" } },
    { ruleId: "BR-CAT-001", domain: "CATEGORY", name: "Planning Category = Lab + Shape + Weight", version: "1.0", status: "CONFIRMED", config: { dimensions: ["lab", "shape", "weightBand"], colorEnabled: false, clarityEnabled: false, treatmentEnabled: false } },
    { ruleId: "BR-CUST-PRI-001", domain: "PRIORITY", name: "Customer Priority Scoring", version: "1.0", status: "OPEN", config: {}, notes: "OPEN — do not auto-assign." },
    { ruleId: "BR-ORD-PRI-001", domain: "PRIORITY", name: "Order Priority Scoring", version: "1.0", status: "OPEN", config: {}, notes: "OPEN — manual classification with reason." },
    { ruleId: "BR-WIP-001", domain: "WIP", name: "WIP Contribution to Shortage", version: "1.0", status: "OPEN", config: {}, notes: "OPEN — exact contribution rule unconfirmed." },
    { ruleId: "BR-TRANSFER-001", domain: "TRANSFER", name: "Cross-Country Transfer Eligibility", version: "1.0", status: "OPEN", config: {}, notes: "OPEN — no auto transfer." },
    { ruleId: "BR-PLAN-SEL-001", domain: "PLANNING", name: "Plan Selection Logic", version: "1.0", status: "OPEN", config: { autoSelectHighestYield: false }, notes: "OPEN — yield vs coverage trade-off is business decision." },
    { ruleId: "BR-CERT-001", domain: "CERTIFICATION", name: "Rough Certification Intent", version: "1.0", status: "OPEN", config: { intents: ["GIA", "Non-Cert", "Other", "Undecided"] } },
    { ruleId: "BR-FORECAST-001", domain: "FORECAST", name: "Forecast Does Not Create Confirmed Demand", version: "1.0", status: "CONFIRMED", config: { forecastIsAdvisory: true } },
  ];
  for (const r of rules) {
    await prisma.businessRule.create({
      data: {
        ruleId: r.ruleId,
        domain: r.domain,
        name: r.name,
        version: r.version,
        effectiveDate: dayOffset(randInt(30, 365)),
        status: r.status,
        configuration: JSON.stringify(r.config),
        approvedBy: r.status === "CONFIRMED" ? pick(APPROVERS) : null,
        approvedAt: r.status === "CONFIRMED" ? dayOffset(randInt(10, 200)) : null,
        notes: r.notes,
      },
    });
  }
  const flags = [
    { code: "FF_COLOR_DIMENSION", name: "Enable Color as Requirement Dimension", enabled: false },
    { code: "FF_CLARITY_DIMENSION", name: "Enable Clarity as Requirement Dimension", enabled: false },
    { code: "FF_TREATMENT_DIMENSION", name: "Enable Treatment as Requirement Dimension", enabled: false },
    { code: "FF_FORECAST_AUTO_ORDER", name: "Forecast Auto-Creates Production Orders", enabled: false },
    { code: "FF_PLANNER_SELF_APPROVE", name: "Allow Planner to Approve Own Plan", enabled: false },
    { code: "FF_TRANSFER_AUTO", name: "Automatic Cross-Country Transfers", enabled: false },
  ];
  for (const f of flags) {
    await prisma.featureFlag.create({
      data: { code: f.code, name: f.name, enabled: f.enabled, description: "Configurable feature flag — default OFF until business approves." },
    });
  }

  // =========================================================================
  // AUDIT LOGS
  // =========================================================================
  console.log("Seeding audit logs...");
  const auditActions = [
    { actor: "A. Patel", action: "PLAN_CREATED", entity: "PlanningCase", reason: "Initial plan created" },
    { actor: "R. Smith", action: "PLAN_APPROVED", entity: "PlanningCase", reason: "Balanced yield + coverage" },
    { actor: "system", action: "DEMAND_RUN", entity: "DemandRun", reason: "Scheduled 90-day recalculation" },
    { actor: "M. Tanaka", action: "RULE_CHANGE", entity: "BusinessRule", reason: "Approved CONFIRMED rule update" },
    { actor: "B. Cohen", action: "RESERVATION", entity: "RoughStone", reason: "Soft reserve for planning case" },
    { actor: "system", action: "FANTASY_SYNC", entity: "IntegrationSyncRun", reason: "Incremental sync completed" },
    { actor: "C. Lee", action: "PLAN_REPLAN", entity: "PlanningCase", reason: "Actual output missed target category" },
    { actor: "D. Garcia", action: "FORECAST_PUBLISH", entity: "ModelVersion", reason: "New model version published" },
  ];
  for (let i = 0; i < 30; i++) {
    const a = pick(auditActions);
    await prisma.auditLog.create({
      data: {
        actor: a.actor,
        action: a.action,
        entity: a.entity,
        entityId: `ENT-${randInt(1000, 9999)}`,
        reason: a.reason,
        timestamp: dayOffset(randInt(0, 30)),
        correlationId: `TR-${randInt(10000, 99999)}`,
      },
    });
  }

  // =========================================================================
  // DATA QUALITY ISSUES
  // =========================================================================
  console.log("Seeding data quality issues...");
  const dqIssues = [
    { source: "FANTASY", entity: "SalesRecord", rule: "UNKNOWN_LAB", message: "Lab 'IGI' is not in confirmed mapping", severity: "WARNING" },
    { source: "WORKBOOK", entity: "PlanOptionPiece", rule: "UNKNOWN_SHAPE", message: "Raw shape 'TREGAL(2)' not in master mapping", severity: "WARNING" },
    { source: "FANTASY", entity: "RoughStone", rule: "DUPLICATE_IMPORT", message: "Fantasy rough ID FRS-000007 imported twice", severity: "ERROR" },
    { source: "WORKBOOK", entity: "PlanOptionPiece", rule: "EMERALD_5STEP_AMBIGUOUS", message: "Ratio 1.20 between Asscher/Emerald ranges", severity: "BLOCKING" },
    { source: "FANTASY", entity: "PolishedStone", rule: "UNMAPPED_STATUS", message: "Fantasy status 'IN_TRANSIT' has no planning mapping", severity: "WARNING" },
    { source: "FANTASY", entity: "PolishedStone", rule: "MISSING_WEIGHT_BAND", message: "Weight 0.85 below confirmed analytical scope (1.00+)", severity: "INFO" },
    { source: "SALES", entity: "SalesRecord", rule: "FUTURE_DOC_DATE", message: "Doc date 3 days in the future detected", severity: "ERROR" },
    { source: "FANTASY", entity: "RoughStone", rule: "ROUGH_WEIGHT_MISMATCH", message: "Stone Name block has inconsistent rough weights", severity: "BLOCKING" },
  ];
  let issueCounter = 1;
  for (const d of dqIssues) {
    await prisma.dataQualityIssue.create({
      data: {
        issueCode: `DQ-${String(issueCounter++).padStart(4, "0")}`,
        source: d.source,
        entity: d.entity,
        recordId: `REC-${randInt(1000, 9999)}`,
        rule: d.rule,
        message: d.message,
        severity: d.severity,
        status: pick(["OPEN", "OPEN", "IN_REVIEW", "RESOLVED", "IGNORED"]),
        assignedTo: pick(PLANNERS),
        detectedAt: dayOffset(randInt(0, 15)),
      },
    });
  }

  // =========================================================================
  // INTEGRATION SYNC RUNS
  // =========================================================================
  console.log("Seeding integration sync runs...");
  const syncEntities = ["Department", "Location", "Rough", "Polished", "Movement"];
  for (let i = 0; i < 12; i++) {
    const ent = pick(syncEntities);
    const status = pick(["SUCCESS", "SUCCESS", "SUCCESS", "PARTIAL", "FAILED"]);
    const records = randInt(20, 500);
    await prisma.integrationSyncRun.create({
      data: {
        source: "Fantasy",
        entity: ent,
        status,
        recordsFetched: records,
        recordsCreated: Math.floor(records * 0.1),
        recordsUpdated: Math.floor(records * 0.7),
        recordsSkipped: Math.floor(records * 0.2),
        errorsJson: status !== "SUCCESS" ? JSON.stringify({ count: randInt(1, 5), sample: "Connection timeout" }) : null,
        durationMs: randInt(1200, 45000),
        startedAt: dayOffset(randInt(0, 7)),
        finishedAt: dayOffset(randInt(0, 7)),
        nextRunAt: dayOffset(-1),
      },
    });
  }

  // =========================================================================
  // NOTIFICATIONS
  // =========================================================================
  console.log("Seeding notifications...");
  const notifs = [
    { type: "CRITICAL_REQUIREMENT", title: "Critical requirement detected", message: "GIA Round 1.70-1.99 shortage 12 pcs", severity: "CRITICAL" },
    { type: "PLAN_APPROVAL_PENDING", title: "Plan awaiting approval", message: "PC-00003 has 1 option pending approval", severity: "WARNING" },
    { type: "FANTASY_SYNC_FAILURE", title: "Fantasy sync failed", message: "Rough sync failed — 2 errors", severity: "ERROR" },
    { type: "REPLAN_REQUIRED", title: "Replan required", message: "Actual output missed requirement category for PC-00007", severity: "WARNING" },
    { type: "STOCKOUT_PREDICTED", title: "Stockout predicted", message: "GIA Oval 2.00-2.09 projected to stockout in 18 days", severity: "WARNING" },
  ];
  for (const n of notifs) {
    await prisma.notification.create({
      data: {
        type: n.type,
        title: n.title,
        message: n.message,
        severity: n.severity,
        read: rand() < 0.3,
        createdAt: dayOffset(randInt(0, 5)),
      },
    });
  }

  // =========================================================================
  // PLAN-ACTUAL RECONCILIATION (sample)
  // =========================================================================
  console.log("Seeding plan-actual reconciliation...");
  const approvedCases = await prisma.planningCase.findMany({
    where: { status: { in: ["APPROVED", "RELEASED_TO_MANUFACTURING"] } },
    include: { rough: true, versions: { include: { options: true } } },
  });
  for (const pc of approvedCases.slice(0, 6)) {
    const opt = pc.versions[0]?.options[0];
    if (!opt) continue;
    const expectedPieces = opt.expectedPieces;
    const actualPieces = randInt(Math.max(0, expectedPieces - 2), expectedPieces + 1);
    const expTotal = Number(opt.expectedTotalWeight);
    const actTotal = randDec(expTotal * 0.85, expTotal * 1.05, 3);
    const plannedYield = Number(opt.yieldPct);
    const actualYield = Math.round((actTotal / Number(pc.originalRoughWeight)) * 10000) / 100;
    await prisma.planActualReconciliation.create({
      data: {
        planOptionId: opt.id,
        expectedPieces,
        actualPieces,
        expectedTotalWeight: expTotal,
        actualTotalWeight: actTotal,
        plannedYieldPct: plannedYield,
        actualYieldPct: actualYield,
        yieldVariance: Math.round((actualYield - plannedYield) * 100) / 100,
        expectedCoverage: opt.requirementCoverage,
        actualCoverage: Math.min(actualPieces, opt.requirementCoverage),
        coverageVariance: Math.min(actualPieces, opt.requirementCoverage) - opt.requirementCoverage,
        status: actualPieces >= opt.requirementCoverage ? "RECONCILED" : "VARIANCE",
      },
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
