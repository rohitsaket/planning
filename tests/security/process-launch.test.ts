// Every maintained process launch runs without a shell (no Node DEP0190): the running Node
// executable on a local package's declared binary, with an explicit argument array. Exit codes
// pass through, a child that cannot start fails safely, unsafe database targets are refused
// before anything is launched, and no password or full database URL reaches arguments or
// output. A repository scan fails if a shell launch or an `npx` spawn returns.
//
// The spawn boundary is replaced by a recorder wherever a launch would touch a database; the
// real processes started here need none.

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "./harness";
import { launch, packageBin, prismaInvocation, runPrisma, tsxInvocation, type Spawn, type SpawnOutcome } from "../../scripts/process-launch";
import { guardedPrisma, parseGuardArgs } from "../../scripts/db-guard";
import { sectestInvocation } from "../../scripts/with-sectest-db";
import { setupDevelopmentDatabase, type SetupDependencies } from "../../scripts/db-setup-dev";

const PASSWORD = "very-secret-password";
const LOCAL_URL = `postgresql://setup-user:${PASSWORD}@localhost:5432/planning`;
const SECTEST_URL = `postgresql://setup-user:${PASSWORD}@localhost:5432/planning_sectest`;
const leaks = (text: string) => text.includes(PASSWORD) || text.includes("setup-user") || /postgres(ql)?:\/\//.test(text);

/** A spawn boundary that records its calls and answers with the given outcome. */
function recorder(outcome: SpawnOutcome) {
  const calls: Array<{ command: string; args: readonly string[]; options: SpawnSyncOptions }> = [];
  const spawn: Spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return outcome;
  };
  return { calls, spawn };
}

function logSink() {
  const lines: string[] = [];
  return { lines, log: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
}

describe("process launches use an explicit executable and argument array, never a shell", () => {
  test("Prisma and tsx run as the local packages' declared binaries under this Node executable", () => {
    for (const [pkg, inv] of [["prisma", prismaInvocation(["migrate", "deploy"])], ["tsx", tsxInvocation("scripts/x.ts", ["--flag"])]] as const) {
      const manifest = JSON.parse(readFileSync(path.join("node_modules", pkg, "package.json"), "utf8"));
      const declared = typeof manifest.bin === "string" ? manifest.bin : manifest.bin[pkg];
      expect([pkg, inv.command, path.normalize(inv.args[0]) === path.normalize(path.resolve("node_modules", pkg, declared)), existsSync(inv.args[0]), inv.options.shell, inv.options.stdio]).toEqual([pkg, process.execPath, true, true, false, "inherit"]);
    }
    expect(prismaInvocation(["migrate", "deploy"]).args.slice(1)).toEqual(["migrate", "deploy"]);
    expect(tsxInvocation("scripts/x.ts", ["--flag"]).args.slice(1)).toEqual(["scripts/x.ts", "--flag"]);
    expect(packageBin("prisma")).toBe(prismaInvocation([]).args[0]);
  });

  test("an argument with spaces or shell characters stays one value", () => {
    const awkward = ["C:/Planning Project/a b & c;|$(x)`y`.sql", "quote\"d", "'single'", "100%", "^caret", "<in>", "a\\b"];
    expect(prismaInvocation(["db", "execute", "--file", ...awkward]).args.slice(1)).toEqual(["db", "execute", "--file", ...awkward]);
    expect(tsxInvocation("scripts/with space.ts", awkward).args.slice(1)).toEqual(["scripts/with space.ts", ...awkward]);
  });

  test("the environment travels as an object and never appears in the arguments", () => {
    const env = { DATABASE_URL: LOCAL_URL, PATH: process.env.PATH };
    const { calls, spawn } = recorder({ status: 0 });
    expect(runPrisma(["migrate", "deploy"], spawn, env)).toBe(0);
    expect([calls.length, calls[0].options.env === env, calls[0].options.shell, calls[0].args.some(leaks)]).toEqual([1, true, false, false]);
  });

  test("exit codes pass through; a child that never ran or could not start fails safely", () => {
    expect([launch(prismaInvocation([]), recorder({ status: 0 }).spawn).status, launch(prismaInvocation([]), recorder({ status: 42 }).spawn).status, launch(prismaInvocation([]), recorder({ status: null }).spawn).status]).toEqual([0, 42, 1]);
    const failed = Object.assign(new Error(`spawn failed with ${LOCAL_URL}`), { code: "ENOENT" });
    const r = launch(prismaInvocation([], { env: { DATABASE_URL: LOCAL_URL } }), recorder({ status: null, error: failed }).spawn);
    expect([r.status, r.stderr, leaks(r.stderr)]).toEqual([1, "Could not start index.js (ENOENT).", false]);
    expect(runPrisma(["migrate", "deploy"], recorder({ status: null, error: failed }).spawn, { DATABASE_URL: LOCAL_URL })).toBe(1);
  });
});

describe("guarded Prisma commands refuse unsafe targets before launching", () => {
  test("the guard's arguments are parsed as an operation and Prisma's own arguments", () => {
    expect(parseGuardArgs(["test-migrations", "--", "migrate", "deploy"])).toEqual({ operation: "test-migrations", prismaArgs: ["migrate", "deploy"] });
    for (const bad of [[], ["op"], ["op", "--"], ["--", "migrate"], ["op", "migrate", "deploy"]]) expect([JSON.stringify(bad), parseGuardArgs(bad)]).toEqual([JSON.stringify(bad), null]);
  });

  test("unsafe targets exit 3 and nothing is launched; output never reveals the password or URL", () => {
    for (const env of [
      {},
      { DATABASE_URL: "not a url" },
      { DATABASE_URL: `postgresql://setup-user:${PASSWORD}@db.internal.corp:5432/planning_sectest` },
      { DATABASE_URL: LOCAL_URL },
      { DATABASE_URL: SECTEST_URL, APP_ENV: "production" },
      { DATABASE_URL: SECTEST_URL, DEPLOY_ENV: "staging" },
    ]) {
      const { calls, spawn } = recorder({ status: 0 });
      const sink = logSink();
      const code = guardedPrisma("prisma-migrate-reset", ["migrate", "reset", "--force"], { env, spawn, ...sink });
      expect([JSON.stringify(Object.keys(env)), code, calls.length, sink.lines.some(leaks)]).toEqual([JSON.stringify(Object.keys(env)), 3, 0, false]);
    }
  });

  test("an isolated test database launches Prisma once with exactly the given arguments and returns its code", () => {
    const env = { DATABASE_URL: SECTEST_URL };
    const { calls, spawn } = recorder({ status: 7 });
    const sink = logSink();
    expect(guardedPrisma("test-migrations", ["migrate", "deploy"], { env, spawn, ...sink })).toBe(7);
    expect(calls.map((c) => [c.command, c.args.slice(1), c.options.shell, c.options.env === env])).toEqual([[process.execPath, ["migrate", "deploy"], false, true]]);
    expect([sink.lines, sink.lines.some(leaks)]).toEqual([["test-migrations: isolated test database planning_sectest on localhost:5432."], false]);
  });

  test("development setup refuses before launching and passes Prisma's code through", async () => {
    const make = (env: NodeJS.ProcessEnv, status: number | null) => {
      const rec = recorder({ status });
      const sink = logSink();
      let synced = 0;
      const deps: SetupDependencies = { env, spawn: rec.spawn, syncReferenceData: async () => { synced++; return { weightBands: [], labMappings: [], shapeMappings: [] }; }, ...sink };
      return { deps, rec, sink, synced: () => synced };
    };
    const refused = make({ DATABASE_URL: `postgresql://setup-user:${PASSWORD}@db.invalid:5432/planning` }, 0);
    expect([await setupDevelopmentDatabase(refused.deps), refused.rec.calls.length, refused.synced(), refused.sink.lines.some(leaks)]).toEqual([3, 0, 0, false]);
    const failed = make({ DATABASE_URL: LOCAL_URL }, 5);
    expect([await setupDevelopmentDatabase(failed.deps), failed.rec.calls.length, failed.synced()]).toEqual([5, 1, 0]);
    const ok = make({ DATABASE_URL: LOCAL_URL }, 0);
    expect([await setupDevelopmentDatabase(ok.deps), ok.rec.calls[0].args.slice(1), ok.rec.calls[0].options.shell, ok.synced(), ok.sink.lines.some(leaks)]).toEqual([0, ["migrate", "deploy"], false, 1, false]);
  });
});

describe("the security-test wrapper", () => {
  test("rewrites the database in the child's environment only, and keeps every argument whole", () => {
    const before = process.env.SECTEST_BASE_URL;
    process.env.SECTEST_BASE_URL = LOCAL_URL;
    try {
      const inv = sectestInvocation(["scripts/some test.ts", "a b", "x&y"], { DATABASE_URL: LOCAL_URL, PATH: process.env.PATH });
      expect(inv === null).toBe(false);
      const env = inv!.options.env as NodeJS.ProcessEnv;
      expect([inv!.command, inv!.args.slice(1), inv!.options.shell, new URL(env.DATABASE_URL!).pathname, env.SECTEST_BASE_URL === LOCAL_URL, inv!.args.some(leaks)]).toEqual([process.execPath, ["scripts/some test.ts", "a b", "x&y"], false, "/planning_sectest", true, false]);
      expect([sectestInvocation([], {}), sectestInvocation(["not-a-script"], {})]).toEqual([null, null]);
    } finally {
      if (before === undefined) delete process.env.SECTEST_BASE_URL;
      else process.env.SECTEST_BASE_URL = before;
    }
  });
});

describe("real processes: no shell warning, arguments intact, codes and refusals end to end", () => {
  test("Prisma starts through the helper and Node reports no DEP0190", () => {
    const inv = prismaInvocation(["--version"], { stdio: "pipe", encoding: "utf8" });
    const r = launch(inv);
    expect([r.status, /prisma\s+:\s*\d+\.\d+\.\d+/.test(r.stdout), /DEP0190/.test(r.stderr)]).toEqual([0, true, false]);
  });

  test("through the security-test wrapper, a script receives awkward arguments intact and its exit code comes back", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "launch-probe-"));
    const probe = path.join(dir, "probe.ts");
    // Prints its arguments and only the database *name* it was given, then exits 7.
    writeFileSync(probe, `console.log(JSON.stringify({ args: process.argv.slice(2), db: new URL(process.env.DATABASE_URL ?? "x:").pathname }));\nprocess.exit(7);\n`);
    try {
      const awkward = ["a b", "x&y", "semi;colon", "$(z)", "quote\"d", "100%"];
      const r = launch(tsxInvocation("scripts/with-sectest-db.ts", [probe, ...awkward], { stdio: "pipe", encoding: "utf8", env: { ...process.env, DATABASE_URL: SECTEST_URL.replace("planning_sectest", "planning"), SECTEST_BASE_URL: "" } }));
      const printed = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()!);
      expect([r.status, printed, /DEP0190/.test(r.stderr), leaks(`${r.stdout}${r.stderr}`)]).toEqual([7, { args: awkward, db: "/planning_sectest" }, false, false]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the guard command refuses a remote target with exit 3 and reveals neither the password nor the URL", () => {
    const r = launch(tsxInvocation("scripts/db-guard.ts", ["prisma-db-push", "--", "db", "push"], { stdio: "pipe", encoding: "utf8", env: { ...process.env, DATABASE_URL: `postgresql://setup-user:${PASSWORD}@db.invalid:5432/planning_sectest` } }));
    expect([r.status, /prisma-db-push refused \(HOST_NOT_LOOPBACK\)/.test(r.stderr), leaks(`${r.stdout}${r.stderr}`), /DEP0190/.test(r.stderr)]).toEqual([3, true, false, false]);
  });

  test("the setup command refuses a remote target with exit 3, without a shell warning", () => {
    const r = spawnSync(process.execPath, [packageBin("tsx"), "scripts/db-setup-dev.ts"], { encoding: "utf8", shell: false, env: { ...process.env, DATABASE_URL: `postgresql://setup-user:${PASSWORD}@db.invalid:5432/planning` } });
    expect([r.status, /Development setup refused \(HOST_NOT_LOOPBACK\)/.test(r.stderr), /DEP0190/.test(`${r.stdout}${r.stderr}`), leaks(`${r.stdout}${r.stderr}`)]).toEqual([3, true, false, false]);
  });
});

describe("repository checks: unsafe launches do not return", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === "node_modules" ? [] : files(full);
      return /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(name) ? [full] : [];
    });
  const sources = ["src", "scripts", "tests", "prisma"].filter((d) => existsSync(d)).flatMap(files).filter((f) => !f.endsWith(path.join("security", "process-launch.test.ts")));

  test("no source enables a shell, runs a command string, or spawns npx", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const rules: Array<[string, RegExp]> = [
        // An option value: true, a platform test, a string, or any other expression but `false`.
        ["shell option other than false", /\bshell\s*:\s*(?!false\b)(true\b|process\.|["'`]|[A-Za-z_$][\w$.]*\s*(?:[,}?]|===|!==))/],
        // A standalone exec()/execSync() call; `.exec(` on a regular expression is not a launch.
        ["shell-string child_process call", /(?<![.\w$])(execSync|exec)\s*\(/],
        ["exec/execSync import", /import\s*\{[^}]*\b(exec|execSync)\b[^}]*\}\s*from\s*["'](node:)?child_process["']/],
        ["npx spawned", /\b(spawn|spawnSync|execFile|execFileSync)\s*\(\s*["'`]npx(\.cmd)?["'`]/],
        ["npx in a launched argument list", /\[\s*["'`]npx["'`]/],
        ["npx prisma command", /["'`]npx prisma\b/],
      ];
      for (const [label, re] of rules) if (re.test(code)) offenders.push(`${file}: ${label}`);
    }
    expect(offenders).toEqual([]);
  });

  test("no package script or guard step spawns Prisma through npx or a shell wrapper", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
    const offenders = Object.entries(scripts).filter(([, cmd]) => /\bnpx\b|with-sectest-db\.ts (npx|tsx)\b|db-guard\.ts \S+ -- (npx|prisma)\b/.test(cmd)).map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  test("the retired utilities are gone and nothing refers to them", () => {
    for (const file of ["scripts/generate-types.ts", "scripts/check-db-connections.ts", "scripts/check-migration-preconditions.ts", "scripts/prisma-cli.ts"]) expect([file, existsSync(file)]).toEqual([file, false]);
    const referrers = sources.filter((f) => /generate-types|check-db-connections|prisma-cli"/.test(readFileSync(f, "utf8")));
    expect(referrers).toEqual([]);
    expect(/generate-types|check-db-connections|check-migration-preconditions/.test(readFileSync("package.json", "utf8"))).toBe(false);
  });
});
