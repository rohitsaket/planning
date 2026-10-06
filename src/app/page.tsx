"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { QueryProvider } from "@/components/providers/query-provider";
import { AuthGate } from "@/components/auth/auth-gate";
import { useAuthStore } from "@/stores/auth-store";
import { isViewAuthorized } from "@/lib/auth/view-permissions";
import { useNavStore, initNavFromHash } from "@/stores/nav-store";
import { AccessRestricted } from "@/components/diamond/shared/access-restricted";
import { OutOfScopeView } from "@/components/diamond/shared/out-of-scope";

// Sidebar pages
import { OverviewView } from "@/components/diamond/views/consolidated/overview-view";
import { SalesAnalysisTrendsView } from "@/components/diamond/views/consolidated/sales-analysis-trends-view";
import { CustomersOrdersView } from "@/components/diamond/views/consolidated/customers-orders-view";
import { InventoryPositionView } from "@/components/diamond/views/consolidated/inventory-position-view";
import { FantasyDataView } from "@/components/diamond/views/consolidated/fantasy-data-view";
import { DataQualityView } from "@/components/diamond/views/data-quality-view";
import { WorkbookImportView } from "@/components/diamond/views/workbook-import-view";
import { UsersAccessView } from "@/components/diamond/views/consolidated/users-access-view";
import { MappingsView } from "@/components/diamond/views/consolidated/mappings-view";
import { AuditLogView } from "@/components/diamond/views/audit-log-view";
// Direct views opened from dashboard tiles and page links
import { CustomersView } from "@/components/diamond/views/customers-view";
import { CountryView } from "@/components/diamond/views/country-view";
import { PolishedView } from "@/components/diamond/views/polished-view";
import { MemoView } from "@/components/diamond/views/memo-view";

/**
 * Every page that can render. Former page ids are not listed: the nav store resolves them
 * through LEGACY_VIEW_ALIASES (src/stores/nav-store.ts) before anything renders.
 */
const VIEW_REGISTRY: Record<string, React.ComponentType> = {
  // Dashboard
  dashboard: OverviewView,
  // Analysis
  "analysis-sales": SalesAnalysisTrendsView,
  "analysis-customers-orders": CustomersOrdersView,
  "analysis-inventory-position": InventoryPositionView,
  // Data
  "fantasy-data": FantasyDataView,
  "data-quality-issues": DataQualityView,
  // Planning
  "planning-workbook-import": WorkbookImportView,
  // Administration
  "admin-users-access": UsersAccessView,
  "admin-mappings": MappingsView,
  "admin-audit-log": AuditLogView,

  // Direct views opened from dashboard tiles and page links.
  "analysis-customers": CustomersView,
  "analysis-country": CountryView,
  "analysis-polished": PolishedView,
  "analysis-memo": MemoView,
};

export default function Home() {
  useEffect(() => {
    initNavFromHash();
    const onHashChange = () => initNavFromHash();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const view = useNavStore((s) => s.view);
  const perms = useAuthStore((s) => s.user?.permissions);
  const authorized = isViewAuthorized(perms, view);

  const ViewComponent = VIEW_REGISTRY[view] ?? OverviewView;

  return (
    <QueryProvider>
      <AuthGate>
        <AppShell>
          {/* Former manufacturing links: a plain "not available" state that shows no data,
              so it needs no page permission. */}
          {view === "out-of-scope" ? <OutOfScopeView /> : authorized ? <ViewComponent /> : <AccessRestricted viewId={view} />}
        </AppShell>
      </AuthGate>
    </QueryProvider>
  );
}
