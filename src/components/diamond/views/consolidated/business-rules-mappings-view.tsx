"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { BusinessRulesView } from "@/components/diamond/views/business-rules-view";
import { WeightBandsView } from "@/components/diamond/views/weight-bands-view";
import { LabMappingsView } from "@/components/diamond/views/lab-mappings-view";
import { ShapeMappingsView } from "@/components/diamond/views/shape-mappings-view";
import { ShieldCheck, Scale, Gem, Diamond, Workflow } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "rules", label: "Business Rules", icon: <ShieldCheck className="h-3.5 w-3.5" />, permission: "business_rule.read", component: BusinessRulesView },
  { id: "weight-bands", label: "Weight Bands", icon: <Scale className="h-3.5 w-3.5" />, permission: "config.read", component: WeightBandsView },
  { id: "lab-mappings", label: "Lab Mapping", icon: <Gem className="h-3.5 w-3.5" />, permission: "config.read", component: LabMappingsView },
  { id: "shape-mappings", label: "Shape Mapping", icon: <Diamond className="h-3.5 w-3.5" />, permission: "config.read", component: ShapeMappingsView },
  { id: "status-mappings", label: "Status Mapping", icon: <Workflow className="h-3.5 w-3.5" />, permission: "business_rule.read", component: BusinessRulesView },
];

export function BusinessRulesMappingsView() {
  return (
    <TabbedHostView
      title="Business Rules and Mappings"
      subtitle="Operational rule configurations, carat weight band standards, laboratory normalizations, and ERP status mappings"
      tabs={TABS}
      defaultTab="rules"
    />
  );
}
