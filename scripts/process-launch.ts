import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnSyncOptions & { shell: false };
}

export interface SpawnOutcome {
  status: number | null;
  error?: Error;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
}

export type Spawn = (command: string, args: readonly string[], options: SpawnSyncOptions) => SpawnOutcome;

export interface LaunchOptions {
  env?: NodeJS.ProcessEnv;
  stdio?: SpawnSyncOptions["stdio"];
  encoding?: BufferEncoding;
  timeout?: number;
}

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

export function prismaInvocation(args: readonly string[], opts: LaunchOptions = {}): Invocation {
  return nodeInvocation(packageBin("prisma"), args, opts);
}

export function tsxInvocation(script: string, args: readonly string[] = [], opts: LaunchOptions = {}): Invocation {
  return nodeInvocation(packageBin("tsx"), [script, ...args], opts);
}

export function launch(inv: Invocation, spawn: Spawn = spawnSync): { status: number; stdout: string; stderr: string } {
  const r = spawn(inv.command, inv.args, inv.options);
  const text = (v: string | Buffer | null | undefined) => (v == null ? "" : v.toString());
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    return { status: 1, stdout: text(r.stdout), stderr: `Could not start ${path.basename(String(inv.args[0] ?? inv.command))} (${code}).` };
  }
  return { status: r.status ?? 1, stdout: text(r.stdout), stderr: text(r.stderr) };
}

export function runPrisma(args: readonly string[], spawn: Spawn = spawnSync, env: NodeJS.ProcessEnv = process.env): number {
  const r = launch(prismaInvocation(args, { env }), spawn);
  if (r.stderr) console.error(r.stderr);
  return r.status;
}
