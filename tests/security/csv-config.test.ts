import { describe, expect, test } from "./harness";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { csvSafeCell, toCsv, columnExportValue, type CsvColumn } from "@/lib/csv-export";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

describe("CSV formula neutralisation (SEC-006)", () => {
  for (const v of ["=1+1", "+SUM(A1:A2)", "-1+2", "@SUM(A1:A2)", '=HYPERLINK("http://evil","x")', "\t=1+1", "\r=1+1", "  =cmd|' /C calc'!A0"]) {
    test(`${JSON.stringify(v)} is exported as text`, () => {
      const cell = csvSafeCell(v);
      expect(cell.startsWith(`"'`)).toBe(true);
      expect(cell).toContain(v.replace(/"/g, '""'));
    });
  }
  test("legitimate values are untouched: numbers, negative numbers, plain text, quotes", () => {
    expect(csvSafeCell(-5)).toBe("-5");
    expect(csvSafeCell("-5.25")).toBe('"-5.25"');
    expect(csvSafeCell(12.5)).toBe("12.5");
    expect(csvSafeCell("GIA Oval 2.10-2.49")).toBe('"GIA Oval 2.10-2.49"');
    expect(csvSafeCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvSafeCell(null)).toBe('""');
  });
});

describe("CSV export values (FUNC-001): component-backed columns export the business value", () => {
  interface Row { status: string; reservedBy: string; weight: number; nested: { a: number } }
  const element = { $$typeof: Symbol.for("react.element"), type: "span", props: {} }; // what a JSX cell returns
  const columns: CsvColumn<Row>[] = [
    { key: "status", header: "Status", cell: () => element },
    { key: "reservedBy", header: "Reserved By", cell: () => element },
    { key: "weight", header: "Weight", cell: (r) => r.weight.toFixed(2) },
    { key: "computed", header: "Computed", cell: () => element, sortValue: (r) => r.weight * 2 },
    { key: "custom", header: "Custom", cell: () => element, exportValue: (r) => `${r.status}/${r.nested.a}` },
  ];
  const rows: Row[] = [{ status: "RESERVED", reservedBy: "=planner1", weight: 1.5, nested: { a: 7 } }];
  test("every column exports the source value, none is blank, none is '[object Object]'", () => {
    for (const c of columns) {
      const v = columnExportValue(c, rows[0]);
      expect(v).not.toBeNull();
      expect(String(v)).not.toContain("[object");
    }
    expect(columnExportValue(columns[0], rows[0])).toBe(rows[0].status);
    expect(columnExportValue(columns[3], rows[0])).toBe(3);
    expect(columnExportValue(columns[4], rows[0])).toBe("RESERVED/7");
  });
  test("toCsv output matches the screen's source values and neutralises the hostile one", () => {
    const [header, line] = toCsv(columns, rows).split("\r\n");
    expect(header).toBe('"Status","Reserved By","Weight","Computed","Custom"');
    expect(line).toBe(`"RESERVED","'=planner1","1.50",3,"RESERVED/7"`);
  });
  test("the shared DataTable uses the central policy", () => {
    const src = read("src/components/diamond/shared/data-table.tsx");
    expect(src).toContain('from "@/lib/csv-export"');
    expect(src).not.toMatch(/replace\(\/"\/g/); // no second, local escaping routine
  });
});

describe("no authentication shortcuts (SEC-001 regression guard)", () => {
  test("the guard has no environment-conditional or hard-coded principal", () => {
    const guard = read("src/lib/api/with-api.ts") + read("src/lib/auth/session.ts") + read("src/proxy.ts");
    expect(guard).not.toMatch(/dev-admin|dev-session|BYPASS|SKIP_AUTH/i);
    expect(guard).not.toMatch(/principal\s*=\s*\{/); // a principal may only come from resolvePrincipal()
    expect(guard).not.toMatch(/headers\.get\("x-(user|role|admin|actor)"\)/i);
  });
});

describe("proxy configuration (SEC-003)", () => {
  const caddy = read("Caddyfile");
  test("no request-derived value can choose an upstream", () => {
    expect(caddy).not.toContain("XTransformPort");
    expect(caddy).not.toMatch(/reverse_proxy[^\n]*\{(query|http\.request|header|path|uri)/);
    const upstreams = [...caddy.matchAll(/reverse_proxy\s+(\S+)/g)].map((m) => m[1]).sort();
    expect(upstreams).toEqual(["127.0.0.1:3000", "127.0.0.1:3001"]);
  });
  test("the app client no longer sends a port", () => {
    expect(read("src/components/diamond/realtime-provider.tsx")).not.toContain("XTransformPort");
  });
});

describe("repository hygiene (CFG-002) and service config (SEC-004)", () => {
  test(".env and runtime databases are not tracked; .env.example holds no real credential", () => {
    const tracked = execSync("git ls-files --cached .env db", { cwd: ROOT }).toString().trim();
    expect(tracked).toBe("");
    expect(read(".env.example")).toContain("USER:PASSWORD@");
    expect(read(".gitignore")).toContain("db/*.db");
  });
  test("notifications service: no wildcard CORS, loopback bind, token-gated broadcast", () => {
    const src = read("mini-services/notifications-service/index.ts");
    expect(src).not.toMatch(/origin:\s*"\*"/);
    expect(src).not.toContain('"Access-Control-Allow-Origin", "*"');
    expect(src).toContain('"127.0.0.1"');
    expect(src).toContain("timingSafeEqual");
  });
});
