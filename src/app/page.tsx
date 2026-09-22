"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { QueryProvider } from "@/components/providers/query-provider";
import { AuthGate } from "@/components/auth/auth-gate";
import { useAuthStore } from "@/stores/auth-store";
import { isViewAuthorized } from "@/lib/auth/view-permissions";
import { useNavStore, initNavFromHash } from "@/stores/nav-store";
import { AccessRestricted } from "@/components/diamond/shared/access-restricted";

// Core and Direct Views
import { DashboardView } from "@/components/diamond/views/dashboard-view";
import { OverallDataView } from "@/components/diamond/views/overall-data-view";
import { DataQualityView } from "@/components/diamond/views/data-quality-view";
import { DemandTraceView } from "@/components/diamond/views/demand-trace-view";
import { RequirementsMatrixView } from "@/components/diamond/views/requirements-matrix-view";
import { PriorityQueueView } from "@/components/diamond/views/priority-queue-view";
import { RoughAvailabilityView } from "@/components/diamond/views/rough-availability-view";
import { WorkbookImportView } from "@/components/diamond/views/workbook-import-view";
import { PlanComparisonView } from "@/components/diamond/views/plan-comparison-view";
import { ApprovalQueueView } from "@/components/diamond/views/approval-queue-view";
import { TraceabilityView } from "@/components/diamond/views/traceability-view";
import { ReportsView } from "@/components/diamond/views/reports-view";
import { AuditLogView } from "@/components/diamond/views/audit-log-view";
import { FantasySyncView } from "@/components/diamond/views/fantasy-sync-view";

// Consolidated Host Views
import { FantasyLiveView } from "@/components/diamond/views/consolidated/fantasy-live-view";
import { DemandOverviewView } from "@/components/diamond/views/consolidated/demand-overview-view";
import { InventoryPositionView } from "@/components/diamond/views/consolidated/inventory-position-view";
import { CustomersOrdersView } from "@/components/diamond/views/consolidated/customers-orders-view";
import { StockStrategyView } from "@/components/diamond/views/consolidated/stock-strategy-view";
import { OrdersExceptionsView } from "@/components/diamond/views/consolidated/orders-exceptions-view";
import { ReplenishmentAllocationView } from "@/components/diamond/views/consolidated/replenishment-allocation-view";
import { PlanningWorkbenchHostView } from "@/components/diamond/views/consolidated/planning-workbench-host-view";
import { ManufacturingOverviewView } from "@/components/diamond/views/consolidated/manufacturing-overview-view";
import { EvaluationReconciliationView } from "@/components/diamond/views/consolidated/evaluation-reconciliation-view";
import { DataScienceForecastingView } from "@/components/diamond/views/consolidated/data-science-forecasting-view";
import { PredictiveModelsView } from "@/components/diamond/views/consolidated/predictive-models-view";
import { UsersAccessView } from "@/components/diamond/views/consolidated/users-access-view";
import { BusinessRulesMappingsView } from "@/components/diamond/views/consolidated/business-rules-mappings-view";
import { SystemSettingsView } from "@/components/diamond/views/consolidated/system-settings-view";

// Legacy Views (for direct view rendering / backward compatibility)
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
import { AgingDashboardView } from "@/components/diamond/views/aging-dashboard-view";
import { ReorderSignalsView } from "@/components/diamond/views/reorder-signals-view";
import { DemandHistoryView } from "@/components/diamond/views/demand-history-view";
import { TransferAnalyzerView } from "@/components/diamond/views/transfer-analyzer-view";
import { PlanningCasesView } from "@/components/diamond/views/planning-cases-view";
import { PlanningWorkbenchView } from "@/components/diamond/views/planning-workbench-view";
import { PlannedPiecesView } from "@/components/diamond/views/planned-pieces-view";
import { ReservationsView } from "@/components/diamond/views/reservations-view";
import { AnomalyDetectionView } from "@/components/diamond/views/anomaly-detection-view";
import { YieldPredictionView } from "@/components/diamond/views/yield-prediction-view";
import { FantasyRoughView } from "@/components/diamond/views/fantasy-rough-view";
import { FantasyPolishedView } from "@/components/diamond/views/fantasy-polished-view";
import { FantasyDepartmentsView } from "@/components/diamond/views/fantasy-departments-view";
import { FantasyLocationsView } from "@/components/diamond/views/fantasy-locations-view";
import { PlanVsActualView } from "@/components/diamond/views/plan-vs-actual-view";
import { ForecastModelsView } from "@/components/diamond/views/forecast-models-view";
import { BusinessRulesView } from "@/components/diamond/views/business-rules-view";
import { WeightBandsView } from "@/components/diamond/views/weight-bands-view";
import { LabMappingsView } from "@/components/diamond/views/lab-mappings-view";
import { ShapeMappingsView } from "@/components/diamond/views/shape-mappings-view";
import { FeatureFlagsView } from "@/components/diamond/views/feature-flags-view";
import { UsersView } from "@/components/diamond/views/users-view";
import { AccessRequestsView } from "@/components/diamond/views/access-requests-view";

const VIEW_REGISTRY: Record<string, React.ComponentType> = {
  // 1. Dashboard
  dashboard: DashboardView,

  // 2. Fantasy ERP
  "fantasy-live": FantasyLiveView,
  "fantasy-sync": FantasySyncView,

  // 3. Overall Data
  "overall-data": OverallDataView,

  // 4. Data Quality
  "data-quality-issues": DataQualityView,

  // 5. Demand and Inventory
  "demand-overview": DemandOverviewView,
  "inventory-position": InventoryPositionView,
  "customers-orders": CustomersOrdersView,
  "demand-trace": DemandTraceView,
  "stock-strategy": StockStrategyView,

  // 6. Requirements and Priority
  "requirements-matrix": RequirementsMatrixView,
  "requirements-priority-queue": PriorityQueueView,
  "orders-exceptions": OrdersExceptionsView,
  "replenishment-allocation": ReplenishmentAllocationView,

  // 7. Planning
  "planning-rough-availability": RoughAvailabilityView,
  "planning-workbook-import": WorkbookImportView,
  "planning-workbench": PlanningWorkbenchHostView,
  "planning-comparison": PlanComparisonView,
  "planning-approval-queue": ApprovalQueueView,

  // 8. Manufacturing
  "manufacturing-overview": ManufacturingOverviewView,
  "manufacturing-traceability": TraceabilityView,

  // 9. Evaluation and Reconciliation
  "plan-vs-actual": EvaluationReconciliationView,

  // 10. Data Science (Advisory)
  "data-science-forecasting": DataScienceForecastingView,
  "data-science-predictive-models": PredictiveModelsView,
  "data-science-prediction-monitoring": ForecastView,

  // 11. Reports
  reports: ReportsView,

  // 12. Administration
  "admin-users-access": UsersAccessView,
  "admin-rules-mappings": BusinessRulesMappingsView,
  "admin-system-settings": SystemSettingsView,
  "admin-audit-log": AuditLogView,

  // Analysis Section Direct Views
  "analysis-executive": DashboardView,
  "analysis-sales": SalesAnalysisView,
  "analysis-sales-trends": SalesTrendsView,
  "analysis-customers-orders": CustomersOrdersView,
  "analysis-inventory-position": InventoryPositionView,
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
  "analysis-demand-trace": DemandTraceView,
  "transfer-analyzer": TransferAnalyzerView,
  "aging-dashboard": AgingDashboardView,
  "requirements-orders": OrdersView,
  "requirements-replenishment": RequirementsMatrixView,
  "requirements-backorders": RequirementsMatrixView,
  "requirements-special": RequirementsMatrixView,
  "requirements-forecast-signals": RequirementsMatrixView,
  "requirements-allocation": RequirementsMatrixView,
  "planning-cases": PlanningCasesView,
  "planning-planned-pieces": PlannedPiecesView,
  "planning-reservations": ReservationsView,
  "manufacturing-tracking": FantasySyncView,
  "manufacturing-departments": FantasyDepartmentsView,
  "manufacturing-locations": FantasyLocationsView,
  "manufacturing-wip": WipView,
  "manufacturing-plan-vs-actual": PlanVsActualView,
  "fantasy-rough": FantasyRoughView,
  "fantasy-polished": FantasyPolishedView,
  "fantasy-departments": FantasyDepartmentsView,
  "fantasy-locations": FantasyLocationsView,
  "fantasy-status-mapping": BusinessRulesView,
  "fantasy-reconciliation": FantasySyncView,
  "data-quality-unmapped-labs": LabMappingsView,
  "data-quality-unmapped-shapes": ShapeMappingsView,
  "data-science-anomaly-detection": AnomalyDetectionView,
  "data-science-yield-prediction": YieldPredictionView,
  "data-science-forecast": ForecastView,
  "data-science-models": ForecastModelsView,
  "data-science-forecast-accuracy": ForecastModelsView,
  "admin-business-rules": BusinessRulesView,
  "admin-weight-bands": WeightBandsView,
  "admin-lab-mappings": LabMappingsView,
  "admin-shape-mappings": ShapeMappingsView,
  "admin-feature-flags": FeatureFlagsView,
  "admin-users": UsersView,
  "admin-access-requests": AccessRequestsView,
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

  const ViewComponent = VIEW_REGISTRY[view] ?? DashboardView;

  return (
    <QueryProvider>
      <AuthGate>
        <AppShell>
          {authorized ? <ViewComponent /> : <AccessRestricted viewId={view} />}
        </AppShell>
      </AuthGate>
    </QueryProvider>
  );
}
