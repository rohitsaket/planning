// ============================================================================
// Notifications WebSocket Mini-Service
// Real-time notification broadcast for the Diamond Manufacturing ERP.
// Frontend connects via: io("/?XTransformPort=3001")  (path "/", port via query)
// Other services push events via: POST http://localhost:3001/broadcast
// ============================================================================

import { createServer, IncomingMessage, ServerResponse } from "http";
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

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /broadcast — push an event to all connected clients
  if (req.method === "POST" && req.url === "/broadcast") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const event: RealtimeEvent = {
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: payload.type || "GENERAL",
          title: payload.title || "Notification",
          message: payload.message || "",
          severity: payload.severity || "info",
          timestamp: new Date().toISOString(),
        };
        eventLog.push(event);
        if (eventLog.length > 50) eventLog.shift();
        io.emit("notification", event);
        console.log(`[broadcast] ${event.type}: ${event.title}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, eventId: event.id, delivered: io.engine.clientsCount }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // GET /health
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", clients: io.engine.clientsCount, events: eventLog.length }));
    return;
  }

  // GET / — basic info
  if (req.method === "GET" && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "notifications", port: PORT, clients: io.engine.clientsCount }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

const io = new Server(httpServer, {
  path: "/socket.io/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const eventLog: RealtimeEvent[] = [];

// Demo events — simulate real-time notifications every 30s
const DEMO_EVENTS: Omit<RealtimeEvent, "id" | "timestamp" | "demoMode">[] = [
  { type: "RESERVATION_CONFLICT", title: "Rough reservation conflict", message: "Planner B. Cohen attempted to reserve FRS-000007 but it's held by A. Patel", severity: "warning" },
  { type: "PLAN_APPROVAL_PENDING", title: "Plan awaiting approval", message: "PC-00003 has 1 option pending approval — yield 20.46%, coverage 100%", severity: "info" },
  { type: "STOCKOUT_WARNING", title: "Stockout predicted", message: "GIA Oval 2.10-2.49 projected to stockout in 18 days at current velocity", severity: "warning" },
  { type: "FANTASY_SYNC_FAILURE", title: "Fantasy sync failed", message: "Rough stock sync encountered 2 errors — connection timeout after 30s", severity: "error" },
  { type: "REQUIREMENT_OVERDUE", title: "Requirement overdue", message: "REQ-00179 (Brilliant Heritage NY) is 5 days overdue — 12 pcs required", severity: "warning" },
  { type: "PLAN_APPROVED", title: "Plan approved", message: "R. Smith approved PC-00010 — released to manufacturing", severity: "success" },
  { type: "DEMAND_RUN_COMPLETED", title: "Demand run completed", message: "90-day demand recalculation finished — 178 categories, shortage 181 pcs", severity: "success" },
  { type: "REPLAN_REQUIRED", title: "Replan required", message: "PC-00001 actual output missed requirement category — yield below threshold", severity: "warning" },
];

let demoIndex = 0;
setInterval(() => {
  const template = DEMO_EVENTS[demoIndex % DEMO_EVENTS.length];
  demoIndex++;
  const event: RealtimeEvent = {
    ...template,
    id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    demoMode: true,
  };
  eventLog.push(event);
  if (eventLog.length > 50) eventLog.shift();
  io.emit("notification", event);
  console.log(`[demo] ${event.type}: ${event.title}`);
}, 30_000);

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id} (total: ${io.engine.clientsCount})`);
  // Send recent event log on connection
  socket.emit("event-log", eventLog.slice(-20));
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id} (total: ${io.engine.clientsCount})`);
  });
  socket.on("error", (err) => console.error(`Socket error (${socket.id}):`, err));
});

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`Notifications WebSocket service running on port ${PORT}`);
  console.log(`  Socket.io: ws://localhost:${PORT}/ (clients connect via /?XTransformPort=${PORT})`);
  console.log(`  Broadcast: POST http://localhost:${PORT}/broadcast`);
  console.log(`  Health:    GET http://localhost:${PORT}/health`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down...");
  httpServer.close(() => process.exit(0));
});
