// ============================================================================
// Notifications WebSocket Mini-Service
// Real-time notification broadcast for the Diamond Manufacturing ERP.
//
// - Listens on 127.0.0.1 only. The reverse proxy exposes /socket.io/* and nothing else.
// - Sockets must present the app's session cookie; it is verified against the app
//   (GET /api/auth/me) on connect and re-verified periodically, so logout/disable cuts the socket.
// - POST /broadcast is service-to-service only: Bearer NOTIFY_SERVICE_TOKEN. Users broadcast
//   through the app route /api/notifications/broadcast (permission notification.broadcast).
// ============================================================================

import { createServer, IncomingMessage, ServerResponse } from "http";
import { timingSafeEqual } from "crypto";
import { Server } from "socket.io";

interface RealtimeEvent {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
  timestamp: string;
  demoMode?: boolean;
}

const PORT = Number(process.env.NOTIFY_PORT || 3001);
const HOST = process.env.NOTIFY_HOST || "127.0.0.1";
const APP_URL = process.env.APP_INTERNAL_URL || "http://127.0.0.1:3000";
const SERVICE_TOKEN = process.env.NOTIFY_SERVICE_TOKEN || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_BODY_BYTES = 16 * 1024;
const SEVERITIES = ["info", "success", "warning", "error"] as const;
const REVALIDATE_MS = 5 * 60_000;

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}

function tokenOk(header: string | undefined): boolean {
  if (SERVICE_TOKEN.length < 32 || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(SERVICE_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Fixed-window limiter for /broadcast.
let windowStart = Date.now();
let windowCount = 0;
function rateLimited(): boolean {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  return ++windowCount > 120;
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null);

function parseEvent(raw: string): Omit<RealtimeEvent, "id" | "timestamp"> | null {
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const type = str(p.type, 50);
  const title = str(p.title, 120);
  const message = typeof p.message === "string" && p.message.length <= 500 ? p.message : null;
  const severity = SEVERITIES.find((s) => s === p.severity) ?? (p.severity === undefined ? "info" : null);
  if (!type || !/^[A-Z0-9_]+$/.test(type) || !title || message === null || !severity) return null;
  return { type, title, message, severity };
}

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // No CORS headers: browsers never call this HTTP API directly.
  if (req.method === "POST" && req.url === "/broadcast") {
    if (!tokenOk(req.headers.authorization)) return json(res, 401, { error: { code: "UNAUTHENTICATED", message: "Service token required." } });
    if (rateLimited()) return json(res, 429, { error: { code: "RATE_LIMITED", message: "Too many broadcasts." } });
    if (Number(req.headers["content-length"] || 0) > MAX_BODY_BYTES) return json(res, 413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Body too large." } });

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES && !aborted) {
        aborted = true;
        json(res, 413, { error: { code: "PAYLOAD_TOO_LARGE", message: "Body too large." } });
        req.destroy();
        return;
      }
      if (!aborted) chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      const parsed = parseEvent(Buffer.concat(chunks).toString("utf8"));
      if (!parsed) return json(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid event payload." } });
      const event: RealtimeEvent = { ...parsed, id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: new Date().toISOString() };
      eventLog.push(event);
      if (eventLog.length > 50) eventLog.shift();
      io.emit("notification", event);
      console.log(JSON.stringify({ ts: event.timestamp, event: "broadcast", type: event.type, id: event.id }));
      json(res, 200, { ok: true, eventId: event.id, delivered: io.engine.clientsCount });
    });
    return;
  }

  if (req.method === "GET" && req.url === "/health") return json(res, 200, { status: "ok" });
  json(res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
});

const io = new Server(httpServer, {
  path: "/socket.io/",
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"], credentials: true },
  maxHttpBufferSize: 64 * 1024,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Asks the app whether this cookie belongs to a live session. Identity never comes from the client.
async function verifySession(cookie: string | undefined): Promise<{ id: string; username: string } | null> {
  if (!cookie) return null;
  try {
    const r = await fetch(`${APP_URL}/api/auth/me`, { headers: { cookie }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = (await r.json()) as { user?: { id: string; username: string } };
    return data.user ?? null;
  } catch {
    return null;
  }
}

io.use(async (socket, next) => {
  const user = await verifySession(socket.handshake.headers.cookie);
  if (!user) return next(new Error("unauthorized"));
  socket.data.user = user;
  next();
});

const eventLog: RealtimeEvent[] = [];

// Demo events are OFF unless explicitly enabled (never enable in production).
if (process.env.NOTIFY_DEMO_EVENTS === "true") {
  const DEMO: Omit<RealtimeEvent, "id" | "timestamp" | "demoMode">[] = [
    { type: "PLAN_APPROVAL_PENDING", title: "Plan awaiting approval", message: "A planning case has an option pending approval", severity: "info" },
    { type: "STOCKOUT_WARNING", title: "Stockout predicted", message: "A category is projected to stock out at current velocity", severity: "warning" },
    { type: "DEMAND_RUN_COMPLETED", title: "Demand run completed", message: "90-day demand recalculation finished", severity: "success" },
  ];
  let i = 0;
  setInterval(() => {
    const event: RealtimeEvent = { ...DEMO[i++ % DEMO.length], id: `demo-${Date.now()}`, timestamp: new Date().toISOString(), demoMode: true };
    eventLog.push(event);
    if (eventLog.length > 50) eventLog.shift();
    io.emit("notification", event);
  }, 30_000);
}

io.on("connection", (socket) => {
  socket.emit("event-log", eventLog.slice(-20));
  const timer = setInterval(async () => {
    if (!(await verifySession(socket.handshake.headers.cookie))) socket.disconnect(true);
  }, REVALIDATE_MS);
  socket.on("disconnect", () => clearInterval(timer));
  socket.on("error", (err) => console.error(`Socket error (${socket.id}):`, err.message));
});

if (SERVICE_TOKEN.length < 32) console.warn("NOTIFY_SERVICE_TOKEN is missing or shorter than 32 characters: POST /broadcast will reject every request.");

httpServer.listen(PORT, HOST, () => console.log(`Notifications service listening on ${HOST}:${PORT}`));

for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => httpServer.close(() => process.exit(0)));
