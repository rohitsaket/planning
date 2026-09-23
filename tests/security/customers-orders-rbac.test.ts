import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb, testPassword } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { GET as customerSections } from "@/app/api/analysis/customers-orders/route";
import { GET as orderAvailability } from "@/app/api/analysis/customers-orders/orders/route";
import { GET as countries } from "@/app/api/analysis/countries/route";
import { isViewAuthorized, viewPermissions } from "@/lib/auth/view-permissions";
import { resolveActiveTab } from "@/components/diamond/shared/tabbed-host-view";
import type { Permission } from "@/lib/auth/permissions";

/**
 * Customers and Orders — section authorization.
 *
 * The page hosts two sections with two different permissions. Previously one endpoint
 * served both behind a single `customers.read` guard, so an orders-only user was refused
 * before the orders branch could run, and a customers-only user received order-source
 * diagnostics inside the customer readiness payload. Both directions are tested here,
 * through the real handlers.
 *
 * No built-in role holds `orders.read` without `customers.read` — `COMMERCIAL_READ`
 * grants them together — so the one-sided cases use custom roles, which is the model's
 * own supported way to express an arbitrary permission set.
 */

/** A user whose effective permissions are exactly the set given, via a custom role. */
async function makeUserWithPermissions(username: string, permissions: Permission[]) {
  const passwordHash = await hashPassword(testPassword());
  const user = await db.user.create({
    data: { username, displayName: username, role: "VIEWER", passwordHash },
  });
  const role = await db.role.create({
    data: {
      code: `TEST_${username.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`,
      name: `Test role for ${username}`,
      // A custom role keeps its permissions in rows, which is what lets a test express a
      // set no built-in role has.
      isSystem: false,
      status: "ACTIVE",
      permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) },
    },
  });
  await db.userRole.create({ data: { userId: user.id, roleId: role.id, reason: "test fixture" } });
  const { token } = await createSession(user.id, { ip: null, userAgent: "test" });
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

const CUSTOMER_SECTIONS = ["summary", "customers", "customer-detail"] as const;

describe("customers-only access", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUserWithPermissions("co-rbac-customers", ["customers.read"])).cookie;
  });

  test("reads every customer section", async () => {
    for (const section of CUSTOMER_SECTIONS) {
      resetRateLimits();
      const path =
        section === "customer-detail"
          ? "/api/analysis/customers-orders?section=customer-detail&customerKey=ANY"
          : `/api/analysis/customers-orders?section=${section}`;
      const res = await call(customerSections, { path, cookie });
      expect({ section, status: res.status }).toEqual({ section, status: 200 });
    }
  });

  test("is refused the orders section at the server, not merely in the tab strip", async () => {
    resetRateLimits();
    const res = await call(orderAvailability, { path: "/api/analysis/customers-orders/orders", cookie });
    expect(res.status).toBe(403);
  });

  test("receives no order information anywhere in the customer summary", async () => {
    resetRateLimits();
    const res = await call(customerSections, { path: "/api/analysis/customers-orders?section=summary", cookie });
    expect(res.status).toBe(200);

    const payload = JSON.stringify(res.json);
    for (const leaked of [
      "orderSource", "seededOrderCount", "seededOrderLineCount", "fieldsAvailable",
      "fieldsUnavailable", "reasonCode", "FANTASY_ORDER_ENTITY_NOT_SUPPLIED",
      "ORDER_IDENTITY", "orderFreshness", "NOT_CONFIGURED",
    ]) {
      expect(payload.includes(leaked)).toBe(false);
    }
  });

  test("may enter the page, and the page opens on a tab it can read", () => {
    const perms = ["customers.read"];
    expect(isViewAuthorized(perms, "customers-orders")).toBe(true);
    expect(resolveActiveTab(TABS, null, "customers", perms)).toBe("customers");
  });
});

describe("orders-only access", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUserWithPermissions("co-rbac-orders", ["orders.read"])).cookie;
  });

  test("reads the orders section", async () => {
    resetRateLimits();
    const res = await call(orderAvailability, { path: "/api/analysis/customers-orders/orders", cookie });
    expect(res.status).toBe(200);
    expect(res.json.available).toBe(false);
  });

  test("is refused every customer section", async () => {
    for (const section of CUSTOMER_SECTIONS) {
      resetRateLimits();
      const res = await call(customerSections, {
        path: `/api/analysis/customers-orders?section=${section}`,
        cookie,
      });
      expect({ section, status: res.status }).toEqual({ section, status: 403 });
    }
  });

  test("may enter the page — the old single-permission mapping locked this user out", () => {
    const perms = ["orders.read"];
    expect(isViewAuthorized(perms, "customers-orders")).toBe(true);
    expect(isViewAuthorized(perms, "analysis-customers-orders")).toBe(true);
  });

  test("the page opens on Orders rather than showing Access Restricted on the default tab", () => {
    // The default tab is Customers, which this user cannot read. Landing there would
    // render Access Restricted; the resolver skips it instead.
    expect(resolveActiveTab(TABS, null, "customers", ["orders.read"])).toBe("orders");
  });

  test("an unauthorized tab named in the URL is not honoured", () => {
    expect(resolveActiveTab(TABS, "customers", "customers", ["orders.read"])).toBe("orders");
  });
});

describe("page entry requires at least one section permission", () => {
  test("holding neither denies the page", () => {
    // PLANNER-style permissions: real, but unrelated to this page.
    expect(isViewAuthorized(["plan.read", "rough.read"], "customers-orders")).toBe(false);
    expect(isViewAuthorized([], "customers-orders")).toBe(false);
  });

  test("the mapping lists both section permissions and nothing broader", () => {
    expect([...viewPermissions("customers-orders")].sort()).toEqual(["customers.read", "orders.read"]);
    expect([...viewPermissions("analysis-customers-orders")].sort()).toEqual(["customers.read", "orders.read"]);
    // Explicitly not admitted by the most widely held read permission.
    expect(isViewAuthorized(["analysis.read"], "customers-orders")).toBe(false);
  });

  test("no tab is selected when none is authorized, so the host shows Access Restricted", () => {
    expect(resolveActiveTab(TABS, null, "customers", ["plan.read"])).toBe(undefined);
  });

  test("an unmapped view is still denied to everyone", () => {
    expect(viewPermissions("no-such-view")).toEqual([]);
    expect(isViewAuthorized(["customers.read", "orders.read"], "no-such-view")).toBe(false);
  });
});

describe("country and branch section keeps its own permission", () => {
  test("the tab requires analysis.read, which the country API enforces independently", async () => {
    await resetDb();
    resetRateLimits();
    // This user may enter the page through customers.read but holds no analysis.read.
    const { cookie } = await makeUserWithPermissions("co-rbac-nocountry", ["customers.read"]);
    const res = await call(countries, { path: "/api/analysis/countries", cookie });
    expect(res.status).toBe(403);

    // Entering the page does not select a tab the user cannot read.
    expect(resolveActiveTab(TABS, "country", "customers", ["customers.read"])).toBe("customers");
  });

  test("a user with analysis.read reaches it, so the check above is not vacuous", async () => {
    resetRateLimits();
    const { cookie } = await makeUserWithPermissions("co-rbac-country", ["customers.read", "analysis.read"]);
    expect((await call(countries, { path: "/api/analysis/countries", cookie })).status).toBe(200);
    expect(resolveActiveTab(TABS, "country", "customers", ["customers.read", "analysis.read"])).toBe("country");
  });
});

describe("country and lab scope still applies to customer reads", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("co-rbac-scope", "DATA_ANALYST")).cookie;
  });

  test("the server echoes the scope it applied rather than ignoring it", async () => {
    resetRateLimits();
    const res = await call(customerSections, {
      path: "/api/analysis/customers-orders?section=customers&country=IN&lab=GIA&branch=SRT",
      cookie,
    });
    expect(res.status).toBe(200);
    const applied = Object.fromEntries(
      (res.json.activeFilters as Array<{ key: string; value: string }>).map((f) => [f.key, f.value]),
    );
    expect({ country: applied.country, lab: applied.lab, branch: applied.branch }).toEqual({
      country: "IN",
      lab: "GIA",
      branch: "SRT",
    });
  });

  test("an unrecognized filter value is refused rather than silently widening the result", async () => {
    resetRateLimits();
    const res = await call(customerSections, {
      path: "/api/analysis/customers-orders?section=customers&dataState=NOT_A_STATE",
      cookie,
    });
    expect(res.status).toBe(400);
  });

  test("an unknown section is refused", async () => {
    resetRateLimits();
    const res = await call(customerSections, {
      path: "/api/analysis/customers-orders?section=orders",
      cookie,
    });
    // `orders` is no longer a section of this endpoint and is not silently accepted.
    expect(res.status).toBe(400);
  });
});

/** The page's real tab set, so the resolver is tested against what ships. */
const TABS = [
  { id: "customers", permission: "customers.read" },
  { id: "orders", permission: "orders.read" },
  { id: "country", permission: "analysis.read" },
] as const;
