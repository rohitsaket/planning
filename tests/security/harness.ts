/**
 * Minimal test harness for the security suite.
 *
 * The suite was written against `bun:test`, but Bun is not installed and
 * `npm run test:security` consequently executed no test at all — the strongest
 * authorization coverage in the repository never ran. This module provides the same
 * small surface (`describe`, `test`, `expect`, `beforeAll`, `afterAll`, `beforeEach`)
 * on the `tsx` + isolated-database convention every other suite here uses, so the
 * existing tests keep running real route handlers against a real database rather than
 * being rewritten into static assertions.
 *
 * Deliberately tiny: it implements only the matchers this suite actually uses. An
 * unimplemented matcher fails loudly instead of silently passing.
 */

type Hook = () => void | Promise<void>;

interface RegisteredTest {
  readonly suite: string;
  readonly name: string;
  readonly fn: Hook;
}

interface RegisteredSuite {
  readonly name: string;
  readonly beforeAll: Hook[];
  readonly afterAll: Hook[];
  readonly beforeEach: Hook[];
  readonly tests: RegisteredTest[];
  readonly file: FileScope;
}

/**
 * File-level hooks. The suite registers `beforeAll`/`afterAll`/`beforeEach` at module
 * top level, which Bun scopes to the file. The runner calls `beginModule()` before each
 * import so those hooks apply to that module's suites and to no others.
 */
interface FileScope {
  readonly beforeAll: Hook[];
  readonly afterAll: Hook[];
  readonly beforeEach: Hook[];
  ran: boolean;
}

const suites: RegisteredSuite[] = [];
let current: RegisteredSuite | null = null;
let fileScope: FileScope = { beforeAll: [], afterAll: [], beforeEach: [], ran: false };
const fileScopes: FileScope[] = [fileScope];

/** Starts a new file scope. Called by the runner before importing each test module. */
export function beginModule(): void {
  fileScope = { beforeAll: [], afterAll: [], beforeEach: [], ran: false };
  fileScopes.push(fileScope);
}

export function describe(name: string, body: () => void): void {
  const suite: RegisteredSuite = { name, beforeAll: [], afterAll: [], beforeEach: [], tests: [], file: fileScope };
  suites.push(suite);
  const previous = current;
  current = suite;
  try {
    body();
  } finally {
    current = previous;
  }
}

/** Hooks declared outside a describe belong to the module, exactly as in Bun. */
function hookTarget(): { beforeAll: Hook[]; afterAll: Hook[]; beforeEach: Hook[] } {
  return current ?? fileScope;
}

export function test(name: string, fn: Hook): void {
  if (!current) throw new Error("test() must be called inside describe()");
  current.tests.push({ suite: current.name, name, fn });
}

export const it = test;

export function beforeAll(fn: Hook): void {
  hookTarget().beforeAll.push(fn);
}

export function afterAll(fn: Hook): void {
  hookTarget().afterAll.push(fn);
}

export function beforeEach(fn: Hook): void {
  hookTarget().beforeEach.push(fn);
}

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

function render(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text.length > 600 ? `${text.slice(0, 600)}…` : text;
  } catch {
    return String(value);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (k) => k in (b as object) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** Subset comparison: every key in `expected` must match, extra keys in `actual` are ignored. */
function matchesObject(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== "object" || expected === null) return deepEqual(actual, expected);
  if (typeof actual !== "object" || actual === null) return false;
  return Object.entries(expected as Record<string, unknown>).every(([k, v]) => {
    const got = (actual as Record<string, unknown>)[k];
    return typeof v === "object" && v !== null ? matchesObject(got, v) : deepEqual(got, v);
  });
}

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toMatchObject(expected: unknown): void;
  toContain(expected: unknown): void;
  toMatch(expected: RegExp | string): void;
  toThrow(expected?: RegExp | string): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toHaveLength(expected: number): void;
  toBeCloseTo(expected: number, digits?: number): void;
}

function buildMatchers(actual: unknown, negated: boolean): Matchers {
  const check = (passed: boolean, describeExpectation: string) => {
    if (passed === negated) {
      throw new AssertionError(
        `expected ${render(actual)}${negated ? " not" : ""} ${describeExpectation}`,
      );
    }
  };

  return {
    toBe: (expected) => check(Object.is(actual, expected), `to be ${render(expected)}`),
    toEqual: (expected) => check(deepEqual(actual, expected), `to equal ${render(expected)}`),
    toMatchObject: (expected) => check(matchesObject(actual, expected), `to match object ${render(expected)}`),
    toContain: (expected) => {
      const passed =
        typeof actual === "string"
          ? actual.includes(String(expected))
          : Array.isArray(actual)
          ? actual.some((v) => deepEqual(v, expected))
          : actual instanceof Set
          ? actual.has(expected)
          : false;
      check(passed, `to contain ${render(expected)}`);
    },
    toMatch: (expected) => {
      const text = String(actual);
      const passed = expected instanceof RegExp ? expected.test(text) : text.includes(expected);
      check(passed, `to match ${expected instanceof RegExp ? expected.toString() : render(expected)}`);
    },
    toThrow: (expected) => {
      if (typeof actual !== "function") throw new AssertionError("toThrow() requires a function");
      let thrown: unknown;
      let threw = false;
      try {
        (actual as () => unknown)();
      } catch (e) {
        threw = true;
        thrown = e;
      }
      if (!threw) {
        check(false, "to throw");
        return;
      }
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      const passed =
        expected === undefined
          ? true
          : expected instanceof RegExp
          ? expected.test(message)
          : message.includes(expected);
      check(passed, `to throw ${expected === undefined ? "" : render(String(expected))}`.trim());
    },
    toBeGreaterThan: (expected) => check(Number(actual) > expected, `to be greater than ${expected}`),
    toBeGreaterThanOrEqual: (expected) => check(Number(actual) >= expected, `to be >= ${expected}`),
    toBeLessThan: (expected) => check(Number(actual) < expected, `to be less than ${expected}`),
    toBeLessThanOrEqual: (expected) => check(Number(actual) <= expected, `to be <= ${expected}`),
    toBeNull: () => check(actual === null, "to be null"),
    toBeUndefined: () => check(actual === undefined, "to be undefined"),
    toBeDefined: () => check(actual !== undefined, "to be defined"),
    toBeTruthy: () => check(Boolean(actual), "to be truthy"),
    toBeFalsy: () => check(!actual, "to be falsy"),
    toHaveLength: (expected) =>
      check((actual as { length?: number })?.length === expected, `to have length ${expected}`),
    toBeCloseTo: (expected, digits = 2) =>
      check(Math.abs(Number(actual) - expected) < Math.pow(10, -digits) / 2, `to be close to ${expected} (${digits} digits)`),
  };
}

interface AsyncMatchers {
  toThrow(expected?: RegExp | string): Promise<void>;
}

function rejectsMatchers(promise: Promise<unknown>, negated: boolean): AsyncMatchers {
  return {
    toThrow: async (expected) => {
      let threw = false;
      let message = "";
      try {
        await promise;
      } catch (e) {
        threw = true;
        message = e instanceof Error ? e.message : String(e);
      }
      const matched =
        !threw
          ? false
          : expected === undefined
          ? true
          : expected instanceof RegExp
          ? expected.test(message)
          : message.includes(expected);
      if (matched === negated) {
        throw new AssertionError(`expected promise${negated ? " not" : ""} to reject${threw ? ` (rejected with: ${message})` : " (it resolved)"}`);
      }
    },
  };
}

export interface Expectation extends Matchers {
  readonly not: Matchers & { readonly rejects: AsyncMatchers };
  readonly rejects: AsyncMatchers;
  readonly resolves: Matchers;
}

export function expect(actual: unknown): Expectation {
  const positive = buildMatchers(actual, false);
  const negative = buildMatchers(actual, true);
  const asPromise = () => {
    if (!(actual && typeof (actual as Promise<unknown>).then === "function")) {
      throw new AssertionError("rejects/resolves requires a promise");
    }
    return actual as Promise<unknown>;
  };

  // Accessors are defined, never spread: Object.assign would *invoke* a getter while
  // copying it, so every expect() would evaluate .rejects and throw immediately.
  const notTarget: Record<string, unknown> = { ...negative };
  Object.defineProperty(notTarget, "rejects", { get: () => rejectsMatchers(asPromise(), true) });

  const target: Record<string, unknown> = { ...positive, not: notTarget };
  Object.defineProperty(target, "rejects", { get: () => rejectsMatchers(asPromise(), false) });
  Object.defineProperty(target, "resolves", { get: () => positive });

  return target as unknown as Expectation;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface RunSummary {
  readonly passed: number;
  readonly failed: number;
  readonly failures: readonly string[];
}

/** Runs every registered suite in registration order and reports the outcome. */
export async function runRegisteredSuites(filter?: string): Promise<RunSummary> {
  let passed = 0;
  const failures: string[] = [];

  for (const suite of suites) {
    if (filter && !suite.name.toLowerCase().includes(filter.toLowerCase())) continue;
    console.log(`\n--- ${suite.name} ---`);
    let suiteSetupFailed: string | null = null;
    try {
      // Module-level setup runs once, before the first suite declared in that file.
      if (!suite.file.ran) {
        suite.file.ran = true;
        for (const hook of suite.file.beforeAll) await hook();
      }
      for (const hook of suite.beforeAll) await hook();
    } catch (e) {
      suiteSetupFailed = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ beforeAll failed: ${suiteSetupFailed}`);
    }

    for (const t of suite.tests) {
      if (suiteSetupFailed !== null) {
        failures.push(`${suite.name} › ${t.name} (suite setup failed)`);
        console.error(`  ✗ ${t.name}`);
        continue;
      }
      try {
        for (const hook of suite.file.beforeEach) await hook();
        for (const hook of suite.beforeEach) await hook();
        await t.fn();
        passed++;
        console.log(`  ✓ ${t.name}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        failures.push(`${suite.name} › ${t.name}: ${message}`);
        console.error(`  ✗ ${t.name}`);
        console.error(`      ${message.split("\n")[0]}`);
      }
    }

    try {
      for (const hook of suite.afterAll) await hook();
    } catch (e) {
      failures.push(`${suite.name} › afterAll: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Module-level teardown last, so a spawned helper process is stopped exactly once.
  for (const scope of fileScopes) {
    for (const hook of scope.afterAll) {
      try {
        await hook();
      } catch (e) {
        failures.push(`module afterAll: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { passed, failed: failures.length, failures };
}

/** Number of registered tests — used to prove the runner actually loaded the suites. */
export function registeredTestCount(): number {
  return suites.reduce((n, s) => n + s.tests.length, 0);
}
