// Runs once when a Next.js server instance starts (see node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
// Starts the automatic Fantasy synchronisation on the Node.js runtime only; the edge runtime and
// the build step never touch the database or the network.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startFantasySyncScheduler } = await import("./lib/fantasy/scheduler");
  startFantasySyncScheduler();
}
