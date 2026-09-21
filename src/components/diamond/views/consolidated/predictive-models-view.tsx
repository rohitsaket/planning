"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { AnomalyDetectionView } from "@/components/diamond/views/anomaly-detection-view";
import { YieldPredictionView } from "@/components/diamond/views/yield-prediction-view";
import { ForecastModelsView } from "@/components/diamond/views/forecast-models-view";
import { AlertTriangle, TrendingUp, Layers } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "anomaly", label: "Anomaly Detection", icon: <AlertTriangle className="h-3.5 w-3.5" />, badge: "Advisory", badgeVariant: "advisory", component: AnomalyDetectionView },
  { id: "yield", label: "Yield Prediction", icon: <TrendingUp className="h-3.5 w-3.5" />, badge: "Advisory", badgeVariant: "advisory", component: YieldPredictionView },
  { id: "registry", label: "Model Registry", icon: <Layers className="h-3.5 w-3.5" />, badge: "Advisory", badgeVariant: "advisory", component: ForecastModelsView },
];

export function PredictiveModelsView() {
  return (
    <TabbedHostView
      title="Predictive Models"
      subtitle="Experimental yield predictions, rough stone anomaly detection, and training registry"
      tabs={TABS}
      defaultTab="anomaly"
      advisory={true}
    />
  );
}
