"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { QueryProvider } from "@/components/providers/query-provider";
import { useNavStore } from "@/stores/nav-store";
import { DashboardView } from "@/components/diamond/views/dashboard-view";
import { SalesAnalysisView } from "@/components/diamond/views/sales-analysis-view";
import { SalesTrendsView } from "@/components/diamond/views/sales-trends-view";
import { CustomersView } from "@/components/diamond/views/customers-view";
import { OrdersView } from "@/components/diamond/views/orders-view";
import { CountryView } from "@/components/diamond/views/country-view";
import { PolishedView } from "@/components/diamond/views/polished-view";
import { MemoView } from "@/components/diamond/views/memo-view";
import { WipView } from "@/components/diamond/views/wip-view";
import { ForecastView } from "@/components/diamond/views/forecast-view";
import { StockoutView } from "@/components/diamond/views/stockout-view";
import { ExcessView } from "@/components/diamond/views/excess-view";
import { AgingView } from "@/components/diamond/views/aging-view";
import { ReorderSignalsView } from "@/components/diamond/views/reorder-signals-view";
import { DemandHistoryView } from "@/components/diamond/views/demand-history-view";
import { RequirementsMatrixView } from "@/components/diamond/views/requirements-matrix-view";
import { PriorityQueueView } from "@/components/diamond/views/priority-queue-view";
import { RoughAvailabilityView } from "@/components/diamond/views/rough-availability-view";
import { PlanningCasesView } from "@/components/diamond/views/planning-cases-view";
import { WorkbookImportView } from "@/components/diamond/views/workbook-import-view";
import { PlanningWorkbenchView } from "@/components/diamond/views/planning-workbench-view";
import { ApprovalQueueView } from "@/components/diamond/views/approval-queue-view";
import { PlannedPiecesView } from "@/components/diamond/views/planned-pieces-view";
import { ReservationsView } from "@/components/diamond/views/reservations-view";
import { FantasySyncView } from "@/components/diamond/views/fantasy-sync-view";
import { FantasyRoughView } from "@/components/diamond/views/fantasy-rough-view";
import { FantasyPolishedView } from "@/components/diamond/views/fantasy-polished-view";
import { FantasyDepartmentsView } from "@/components/diamond/views/fantasy-departments-view";
import { FantasyLocationsView } from "@/components/diamond/views/fantasy-locations-view";
import { TraceabilityView } from "@/components/diamond/views/traceability-view";
import { PlanVsActualView } from "@/components/diamond/views/plan-vs-actual-view";
import { DataQualityView } from "@/components/diamond/views/data-quality-view";
import { ForecastModelsView } from "@/components/diamond/views/forecast-models-view";
import { ReportsView } from "@/components/diamond/views/reports-view";
import { BusinessRulesView } from "@/components/diamond/views/business-rules-view";
import { WeightBandsView } from "@/components/diamond/views/weight-bands-view";
import { LabMappingsView } from "@/components/diamond/views/lab-mappings-view";
import { ShapeMappingsView } from "@/components/diamond/views/shape-mappings-view";
import { AuditLogView } from "@/components/diamond/views/audit-log-view";
import { FeatureFlagsView } from "@/components/diamond/views/feature-flags-view";
import { UsersView } from "@/components/diamond/views/users-view";

const VIEW_REGISTRY: Record<string, React.ComponentType> = {
  dashboard: DashboardView,
  "analysis-sales": SalesAnalysisView,
  "analysis-sales-trends": SalesTrendsView,
  "analysis-customers": CustomersView,
  "analysis-orders": OrdersView,
  "analysis-country": CountryView,
  "analysis-polished": PolishedView,
  "analysis-memo": MemoView,
  "analysis-wip": WipView,
  "analysis-forecast": ForecastView,
  "analysis-stockout": StockoutView,
  "analysis-excess": ExcessView,
  "analysis-aging": AgingView,
  "analysis-reorder-signals": ReorderSignalsView,
  "demand-history": DemandHistoryView,
  "analysis-executive": DashboardView,
  "requirements-matrix": RequirementsMatrixView,
  "requirements-priority-queue": PriorityQueueView,
  "requirements-orders": OrdersView,
  "requirements-replenishment": RequirementsMatrixView,
  "requirements-backorders": RequirementsMatrixView,
  "requirements-special": RequirementsMatrixView,
  "requirements-forecast-signals": RequirementsMatrixView,
  "requirements-allocation": RequirementsMatrixView,
  "planning-rough-availability": RoughAvailabilityView,
  "planning-cases": PlanningCasesView,
  "planning-workbook-import": WorkbookImportView,
  "planning-workbench": PlanningWorkbenchView,
  "planning-approval-queue": ApprovalQueueView,
  "planning-planned-pieces": PlannedPiecesView,
  "planning-reservations": ReservationsView,
  "manufacturing-tracking": FantasySyncView,
  "manufacturing-departments": FantasyDepartmentsView,
  "manufacturing-locations": FantasyLocationsView,
  "manufacturing-wip": WipView,
  "manufacturing-traceability": TraceabilityView,
  "manufacturing-plan-vs-actual": PlanVsActualView,
  "fantasy-sync": FantasySyncView,
  "fantasy-rough": FantasyRoughView,
  "fantasy-polished": FantasyPolishedView,
  "fantasy-departments": FantasyDepartmentsView,
  "fantasy-locations": FantasyLocationsView,
  "fantasy-status-mapping": BusinessRulesView,
  "fantasy-reconciliation": FantasySyncView,
  "data-quality-issues": DataQualityView,
  "data-quality-unmapped-labs": LabMappingsView,
  "data-quality-unmapped-shapes": ShapeMappingsView,
  "data-science-forecast": ForecastView,
  "data-science-models": ForecastModelsView,
  "data-science-prediction-monitoring": ForecastView,
  "data-science-forecast-accuracy": ForecastModelsView,
  reports: ReportsView,
  "admin-business-rules": BusinessRulesView,
  "admin-weight-bands": WeightBandsView,
  "admin-lab-mappings": LabMappingsView,
  "admin-shape-mappings": ShapeMappingsView,
  "admin-feature-flags": FeatureFlagsView,
  "admin-audit-log": AuditLogView,
  "admin-users": UsersView,
};

export default function Home() {
  useEffect(() => {
    useNavStore.getState().setView(useNavStore.getState().view);
    const hash = window.location.hash.slice(1);
    if (hash) useNavStore.setState({ view: hash as never });
  }, []);

  const view = useNavStore((s) => s.view);
  const View = VIEW_REGISTRY[view] ?? DashboardView;

  return (
    <QueryProvider>
      <AppShell>
        <View />
      </AppShell>
    </QueryProvider>
  );
}
