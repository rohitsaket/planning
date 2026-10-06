// Starts child processes without a shell, on every platform.
//
// `npx` needs a shell on Windows (it is a .cmd file), and a shell joins arguments into one
// command string unescaped — Node's DEP0190, and a path with spaces or `&` becomes several
// arguments or a second command. Every launcher here runs the running Node executable on the
// entry point a locally installed package declares as its binary, with an explicit argument
// array and `shell: false`. The environment is handed to the child as an object; it is never
// placed on the command line, and a failure to start is reported without it.
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnSyncOptions & { shell: false };
}

/** What a finished child reports. `error` is set when it could not be started at all. */
export interface SpawnOutcome {
  status: number | null;
  error?: Error;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
}

/** The spawn boundary, injectable so an invocation can be verified without running it. */
export type Spawn = (command: string, args: readonly string[], options: SpawnSyncOptions) => SpawnOutcome;

export interface LaunchOptions {
  env?: NodeJS.ProcessEnv;
  /** Defaults to "inherit": the child writes straight to this process's stdout and stderr. */
  stdio?: SpawnSyncOptions["stdio"];
  encoding?: BufferEncoding;
  timeout?: number;
}

/** Absolute path of a binary the locally installed package declares in its manifest. */
export function packageBin(pkg: string, bin: string = pkg): string {
  const manifest = require.resolve(`${pkg}/package.json`);
  const declared: unknown = JSON.parse(readFileSync(manifest, "utf8")).bin;
  const entry = typeof declared === "string" ? declared : typeof declared === "object" && declared !== null ? (declared as Record<string, unknown>)[bin] : undefined;
  if (typeof entry !== "string" || entry === "") throw new Error(`The installed ${pkg} package declares no '${bin}' binary.`);
  return path.join(path.dirname(manifest), entry);
}

function nodeInvocation(entry: string, args: readonly string[], opts: LaunchOptions): Invocation {
  return {
    command: process.execPath,
    args: [entry, ...args],
    options: { stdio: opts.stdio ?? "inherit", shell: false, env: opts.env ?? process.env, encoding: opts.encoding, timeout: opts.timeout },
  };
}

/** The project's Prisma CLI with these arguments. */
export function prismaInvocation(args: readonly string[], opts: LaunchOptions = {}): Invocation {
  return nodeInvocation(packageBin("prisma"), args, opts);
}

/** A TypeScript script run by the project's tsx. */
export function tsxInvocation(script: string, args: readonly string[] = [], opts: LaunchOptions = {}): Invocation {
  return nodeInvocation(packageBin("tsx"), [script, ...args], opts);
}

/**
 * Runs an invocation and returns its exit code with any captured output. A child that could
 * not be started exits 1 with a message naming only the error code — never the environment.
 */
export function launch(inv: Invocation, spawn: Spawn = spawnSync): { status: number; stdout: string; stderr: string } {
  const r = spawn(inv.command, inv.args, inv.options);
  const text = (v: string | Buffer | null | undefined) => (v == null ? "" : v.toString());
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    return { status: 1, stdout: text(r.stdout), stderr: `Could not start ${path.basename(String(inv.args[0] ?? inv.command))} (${code}).` };
  }
  return { status: r.status ?? 1, stdout: text(r.stdout), stderr: text(r.stderr) };
}

/** Runs the Prisma CLI with inherited output; returns its exit code (1 if it never started). */
export function runPrisma(args: readonly string[], spawn: Spawn = spawnSync, env: NodeJS.ProcessEnv = process.env): number {
  const r = launch(prismaInvocation(args, { env }), spawn);
  if (r.stderr) console.error(r.stderr);
  return r.status;
}
