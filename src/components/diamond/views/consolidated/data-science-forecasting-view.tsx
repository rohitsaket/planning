"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { ForecastView } from "@/components/diamond/views/forecast-view";
import { ForecastModelsView } from "@/components/diamond/views/forecast-models-view";
import { TrendingUp, Layers, BarChart3 } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "forecast", label: "Predictive Forecast", icon: <TrendingUp className="h-3.5 w-3.5" />, badge: "Advisory", badgeVariant: "advisory", component: ForecastView },
  { id: "models", label: "Model Architecture", icon: <Layers className="h-3.5 w-3.5" />, badge: "Advisory", badgeVariant: "advisory", component: ForecastModelsView },
  { id: "accuracy", label: "Accuracy Backtesting", icon: <BarChart3 className="h-3.5 w-3.5" />, badge: "Advisory", badgeVariant: "advisory", component: ForecastModelsView },
];

export function DataScienceForecastingView() {
  return (
    <TabbedHostView
      title="Forecasting"
      subtitle="Data science demand forecast modeling, trend extrapolation, and backtest accuracy tracking"
      tabs={TABS}
      defaultTab="forecast"
      advisory={true}
    />
  );
}
