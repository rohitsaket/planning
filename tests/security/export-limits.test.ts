import { describe, expect, test } from "./harness";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  EXPORT_ROW_LIMIT_MAX,
  validateExportRowLimit,
  type ExportLimitRejection,
} from "@/lib/config/export-limits";
import { STOCKOUT_EXPORT_LIMIT } from "@/lib/analysis/stockout";
import { EXCESS_EXPORT_LIMIT } from "@/lib/analysis/excess";
import { SALES_EXPORT_LIMIT } from "@/lib/analytics/sales-history";
import { OVERALL_EXPORT_LIMIT } from "@/app/api/fantasy/overall/export/route";

const VALID_DEFAULT = 20_000;

describe("Export limits — an unusable configuration is refused", () => {
  const cases: Array<{ name: string; raw: string | undefined; rejection: ExportLimitRejection | null }> = [
    { name: "absent", raw: undefined, rejection: null },
    { name: "empty string", raw: "", rejection: "NOT_A_NUMBER" },
    { name: "whitespace only", raw: "   ", rejection: "NOT_A_NUMBER" },
    { name: "non-numeric text", raw: "abc", rejection: "NOT_A_NUMBER" },
    { name: "a number with trailing text", raw: "1000rows", rejection: "NOT_A_NUMBER" },
    { name: "Infinity", raw: "Infinity", rejection: "NOT_FINITE" },
    { name: "-Infinity", raw: "-Infinity", rejection: "NOT_FINITE" },
    { name: "an exponent that overflows to Infinity", raw: "1e400", rejection: "NOT_FINITE" },
    { name: "a decimal", raw: "1000.5", rejection: "NOT_AN_INTEGER" },
    { name: "zero", raw: "0", rejection: "NOT_POSITIVE" },
    { name: "negative", raw: "-1", rejection: "NOT_POSITIVE" },
    { name: "above the maximum", raw: String(EXPORT_ROW_LIMIT_MAX + 1), rejection: "ABOVE_MAXIMUM" },
  ];

  for (const c of cases) {
    test(`${c.name} → the built-in default applies`, () => {
      const limit = validateExportRowLimit("TEST_EXPORT_MAX_ROWS", c.raw, VALID_DEFAULT);
      expect({
        rows: limit.rows,
        source: limit.source,
        rejection: limit.rejection,
        rejected: limit.configurationRejected,
      }).toEqual({
        rows: VALID_DEFAULT,
        source: "DEFAULT",
        rejection: c.rejection,
        rejected: c.rejection !== null,
      });
    });
  }

  test("a usable configuration is honoured", () => {
    const limit = validateExportRowLimit("TEST_EXPORT_MAX_ROWS", "5000", VALID_DEFAULT);
    expect({ rows: limit.rows, source: limit.source, rejected: limit.configurationRejected })
      .toEqual({ rows: 5000, source: "ENVIRONMENT", rejected: false });
  });

  test("surrounding whitespace does not make a usable value unusable", () => {
    const limit = validateExportRowLimit("TEST_EXPORT_MAX_ROWS", " 5000 ", VALID_DEFAULT);
    expect({ rows: limit.rows, rejected: limit.configurationRejected }).toEqual({ rows: 5000, rejected: false });
  });

  test("the maximum itself is usable; one more is not", () => {
    const atMax = validateExportRowLimit("TEST_EXPORT_MAX_ROWS", String(EXPORT_ROW_LIMIT_MAX), VALID_DEFAULT);
    const overMax = validateExportRowLimit("TEST_EXPORT_MAX_ROWS", String(EXPORT_ROW_LIMIT_MAX + 1), VALID_DEFAULT);
    expect({ at: atMax.rows, over: overMax.rows, overReason: overMax.rejection })
      .toEqual({ at: EXPORT_ROW_LIMIT_MAX, over: VALID_DEFAULT, overReason: "ABOVE_MAXIMUM" });
  });

  test("every refusal still produces a ceiling an export can actually use", () => {
    const unusable: string[] = [];
    for (const c of cases) {
      const limit = validateExportRowLimit("TEST_EXPORT_MAX_ROWS", c.raw, VALID_DEFAULT);
      if (!Number.isInteger(limit.rows) || limit.rows <= 0 || limit.rows > EXPORT_ROW_LIMIT_MAX) {
        unusable.push(`${c.name} → ${limit.rows}`);
      }
      if (Number.isNaN(limit.rows) || !Number.isFinite(limit.rows)) unusable.push(`${c.name} → not finite`);
    }
    expect(unusable).toEqual([]);
  });

  test("an unusable built-in default is a programming error and is refused outright", async () => {
    const { resolveExportRowLimit } = await import("@/lib/config/export-limits");
    let threw = false;
    try {
      resolveExportRowLimit("TEST_EXPORT_NEVER_SET", Number.NaN);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe("Export limits — the arithmetic an invalid limit used to break", () => {
  function exportShape(total: number, limitRows: number) {
    const target = Math.min(total, limitRows);
    let fetched = 0;
    let guard = 0;
    while (fetched < target && guard++ < 1_000) fetched += Math.min(2_000, target - fetched);
    return { fetched, truncated: total > limitRows };
  }

  test("the old pattern produced zero rows and called the export complete", () => {
    const configured: string = "abc";
    const brokenLimit = Number(configured || 20_000);
    const broken = exportShape(5_000, brokenLimit);
    expect({ fetched: broken.fetched, truncated: broken.truncated }).toEqual({ fetched: 0, truncated: false });
  });

  test("a refused configuration now exports every row and reports honestly", () => {
    const limit = validateExportRowLimit("TEST_EXPORT_MAX_ROWS", "abc", VALID_DEFAULT);
    const fixed = exportShape(5_000, limit.rows);
    expect({ fetched: fixed.fetched, truncated: fixed.truncated }).toEqual({ fetched: 5_000, truncated: false });
  });

  test("a result larger than the ceiling is cut and says so", () => {
    const limit = validateExportRowLimit("TEST_EXPORT_MAX_ROWS", "1000", VALID_DEFAULT);
    const cut = exportShape(5_000, limit.rows);
    expect({ fetched: cut.fetched, truncated: cut.truncated }).toEqual({ fetched: 1_000, truncated: true });
  });
});

describe("Export limits — every export reads its ceiling from the validated helper", () => {
  test("the four configured export ceilings resolved to usable values", () => {
    const limits = [
      { name: "stockout", limit: STOCKOUT_EXPORT_LIMIT },
      { name: "excess", limit: EXCESS_EXPORT_LIMIT },
      { name: "sales", limit: SALES_EXPORT_LIMIT },
      { name: "overall", limit: OVERALL_EXPORT_LIMIT },
    ];
    const unusable = limits
      .filter(({ limit }) => !Number.isInteger(limit.rows) || limit.rows <= 0 || limit.rows > EXPORT_ROW_LIMIT_MAX)
      .map(({ name }) => name);
    expect(unusable).toEqual([]);
  });

  test("no module builds a row ceiling out of the environment by hand", () => {
    const offenders: string[] = [];
    const pattern = /Number\s*\(\s*process\.env\./;
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const rel = full.split(path.sep).join("/");
          const code = readFileSync(full, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^\s*\/\/.*$/gm, "");
          if (pattern.test(code)) offenders.push(rel);
        }
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });

  test("the configuration helpers stay on the server", () => {
    for (const file of ["src/lib/config/export-limits.ts", "src/lib/config/numeric-env.ts"]) {
      const source = readFileSync(file, "utf8");
      expect({ file, guarded: source.includes('typeof window !== "undefined"') }).toEqual({ file, guarded: true });
    }
  });

  test("a refused configuration is logged without the configured value", () => {
    const source = readFileSync("src/lib/config/numeric-env.ts", "utf8");
    expect(/log\("warn", "numeric_configuration_rejected"/.test(source)).toBe(true);
    const logCall = source.slice(source.indexOf('numeric_configuration_rejected'));
    const block = logCall.slice(0, logCall.indexOf("});"));
    expect(/raw|configuredValue|process\.env/.test(block)).toBe(false);
  });

  test("the settings that are not export ceilings are validated too", () => {
    const checks: Array<{ file: string; variable: string }> = [
      { file: "src/lib/auth/session.ts", variable: "SESSION_TTL_HOURS" },
      { file: "src/lib/auth/session.ts", variable: "SESSION_IDLE_MINUTES" },
      { file: "src/lib/api/with-api.ts", variable: "API_PAGE_MAX" },
      { file: "src/lib/api/with-api.ts", variable: "API_SCAN_MAX" },
      { file: "src/lib/fantasy/sync-service.ts", variable: "FANTASY_SYNC_LOCK_LEASE_MS" },
      { file: "src/lib/fantasy/canonical-state-claim.ts", variable: "FANTASY_CANONICAL_CLAIM_LEASE_MS" },
    ];
    const unvalidated = checks.filter(({ file, variable }) => {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const resolved = code.includes(`resolveNumericEnv(`) && code.includes(`"${variable}"`);
      const rawRead = new RegExp(`process\\.env\\.${variable}\\b`).test(code);
      return !resolved || rawRead;
    });
    expect(unvalidated).toEqual([]);
  });
});
