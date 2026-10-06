"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { WeightBandsView } from "@/components/diamond/views/weight-bands-view";
import { LabMappingsView } from "@/components/diamond/views/lab-mappings-view";
import { ShapeMappingsView } from "@/components/diamond/views/shape-mappings-view";
import { StatusMappingsView } from "@/components/diamond/views/status-mappings-view";
import { SarinShapeMappingsView } from "@/components/diamond/views/sarin/sarin-shape-mappings-view";
import { Scale, Gem, Diamond, Workflow, Shapes } from "lucide-react";

export const MAPPINGS_TABS: HostTabItem[] = [
  { id: "weight-bands", label: "Weight Bands", icon: <Scale className="h-3.5 w-3.5" />, permission: "config.read", component: WeightBandsView },
  { id: "lab-mappings", label: "Lab Mapping", icon: <Gem className="h-3.5 w-3.5" />, permission: "config.read", component: LabMappingsView },
  { id: "shape-mappings", label: "Shape Mapping", icon: <Diamond className="h-3.5 w-3.5" />, permission: "config.read", component: ShapeMappingsView },
  { id: "status-mappings", label: "Status Mapping", icon: <Workflow className="h-3.5 w-3.5" />, permission: "config.read", component: StatusMappingsView },
  { id: "sarin-shape-mapping", label: "Sarin Shape Mapping", icon: <Shapes className="h-3.5 w-3.5" />, permission: "sarin.mapping.read", component: SarinShapeMappingsView },
];

export function MappingsView() {
  return <TabbedHostView title="Mappings" subtitle="How incoming values map to business values" tabs={MAPPINGS_TABS} defaultTab="weight-bands" />;
}
