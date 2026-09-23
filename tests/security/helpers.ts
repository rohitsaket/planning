import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { resetRateLimits } from "@/lib/api/rate-limit";
import type { Role } from "@/lib/auth/permissions";

export { db };
export const BASE = "http://localhost:3000";
const PW = "test-only-password-" + Math.random().toString(36).slice(2);
export const testPassword = () => PW;

const TABLES = ["UserRole", "Session", "User", "AuditLog", "RequirementAllocation", "RoughReservation", "PlanOptionPiece", "PlanOption", "PlanVersion", "PlanningCase", "Requirement", "RoughStone", "FeatureFlag", "BusinessRule", "Notification"];

export async function resetDb() {
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
  resetRateLimits();
}

let pwHash: string | null = null;
export async function makeUser(username: string, role: Role, displayName = username) {
  pwHash ??= await hashPassword(PW);
  const user = await db.user.create({ data: { username, displayName, role, passwordHash: pwHash } });
  // Assign the real role record as well as the legacy column, so tests exercise the
  // assignment-based principal resolution rather than only the transitional fallback.
  const roleRow = await db.role.findUnique({ where: { code: role }, select: { id: true } });
  if (roleRow) {
    await db.userRole.create({ data: { userId: user.id, roleId: roleRow.id, reason: "test fixture" } });
  }
  const { token, session } = await createSession(user.id, { ip: null, userAgent: "test" });
  return { user, session, cookie: `${SESSION_COOKIE}=${token}` };
}

type Handler = (req: Request, ctx: { params: Promise<any> }) => Promise<Response>;

export async function call(handler: Handler, o: { method?: string; path?: string; cookie?: string; body?: unknown; raw?: string; params?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.cookie) headers.cookie = o.cookie;
  let body: string | undefined;
  if (o.raw !== undefined) body = o.raw;
  else if (o.body !== undefined) body = JSON.stringify(o.body);
  if (body !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await handler(new Request(`${BASE}${o.path ?? "/api/x"}`, { method, headers, body }), { params: Promise.resolve(o.params ?? {}) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, headers: res.headers };
}

let n = 0;
export async function makeRough(planningStatus = "AVAILABLE") {
  n++;
  return db.roughStone.create({ data: { fantasyRoughId: `FR-T-${n}-${Date.now()}`, kapan: "K1", packet: "P1", stoneName: `T${n}`, roughWeight: 5, country: "IN", branch: "SRT", fantasyStatus: "IN_STOCK", planningStatus } });
}

// A planning case with one version and two options; the first option is selected unless told otherwise.
export async function makeCase(o: { status?: string; planner?: string; select?: boolean; roughId?: string } = {}) {
  n++;
  const rough = o.roughId ? { id: o.roughId } : await makeRough();
  const c = await db.planningCase.create({
    data: { caseCode: `PC-T-${n}-${Date.now()}`, roughId: rough.id, stoneName: "T", kapan: "K1", packet: "P1", originalRoughWeight: 5, planner: o.planner ?? "Some Planner", status: o.status ?? "APPROVAL_PENDING" },
  });
  const v = await db.planVersion.create({ data: { planningCaseId: c.id, versionNumber: 1, createdBy: o.planner ?? "Some Planner", status: "DRAFT" } });
  const mk = (i: number) => db.planOption.create({ data: { optionCode: `OPT-T-${n}-${i}-${Date.now()}`, versionId: v.id, optionNumber: i, expectedPieces: 2, expectedTotalWeight: 2, yieldPct: 40 } });
  const [o1, o2] = [await mk(1), await mk(2)];
  if (o.select !== false) await db.planningCase.update({ where: { id: c.id }, data: { selectedOptionId: o1.id } });
  return { caseId: c.id, roughId: rough.id, versionId: v.id, optionIds: [o1.id, o2.id] };
}
