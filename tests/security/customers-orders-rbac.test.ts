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
import { resolveViewAlias } from "@/stores/nav-store";
import type { Permission } from "@/lib/auth/permissions";

async function makeUserWithPermissions(username: string, permissions: Permission[]) {
  const passwordHash = await hashPassword(testPassword());
  const user = await db.user.create({
    data: { username, displayName: username, role: "VIEWER", passwordHash },
  });
  const role = await db.role.create({
    data: {
      code: `TEST_${username.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`,
      name: `Test role for ${username}`,
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
    expect(isViewAuthorized(perms, "analysis-customers-orders")).toBe(true);
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
    expect(isViewAuthorized(perms, "analysis-customers-orders")).toBe(true);
    expect(resolveViewAlias("customers-orders").view).toBe("analysis-customers-orders");
  });

  test("the page opens on Orders rather than showing Access Restricted on the default tab", () => {
    expect(resolveActiveTab(TABS, null, "customers", ["orders.read"])).toBe("orders");
  });

  test("an unauthorized tab named in the URL is not honoured", () => {
    expect(resolveActiveTab(TABS, "customers", "customers", ["orders.read"])).toBe("orders");
  });
});

describe("page entry requires at least one section permission", () => {
  test("holding neither denies the page", () => {
    expect(isViewAuthorized(["config.read", "fantasy.read"], "analysis-customers-orders")).toBe(false);
    expect(isViewAuthorized([], "analysis-customers-orders")).toBe(false);
  });

  test("the mapping lists both section permissions and nothing broader", () => {
    expect([...viewPermissions("analysis-customers-orders")].sort()).toEqual(["customers.read", "orders.read"]);
    expect(isViewAuthorized(["analysis.read"], "analysis-customers-orders")).toBe(false);
  });

  test("no tab is selected when none is authorized, so the host shows Access Restricted", () => {
    expect(resolveActiveTab(TABS, null, "customers", ["config.read"])).toBe(undefined);
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
    const { cookie } = await makeUserWithPermissions("co-rbac-nocountry", ["customers.read"]);
    const res = await call(countries, { path: "/api/analysis/countries", cookie });
    expect(res.status).toBe(403);

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
    expect(res.status).toBe(400);
  });
});

const TABS = [
  { id: "customers", permission: "customers.read" },
  { id: "orders", permission: "orders.read" },
  { id: "country", permission: "analysis.read" },
] as const;
