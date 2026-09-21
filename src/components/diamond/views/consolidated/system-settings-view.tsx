"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { FeatureFlagsView } from "@/components/diamond/views/feature-flags-view";
import { FantasySyncView } from "@/components/diamond/views/fantasy-sync-view";
import { Workflow, Settings } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "feature-flags", label: "Feature Flags", icon: <Workflow className="h-3.5 w-3.5" />, permission: "feature_flag.read", component: FeatureFlagsView },
  { id: "integrations", label: "System Integrations", icon: <Settings className="h-3.5 w-3.5" />, permission: "fantasy.sync", component: FantasySyncView },
];

export function SystemSettingsView() {
  return (
    <TabbedHostView
      title="System Settings"
      subtitle="Enterprise system runtime flags, environment feature toggles, and external integration connection settings"
      tabs={TABS}
      defaultTab="feature-flags"
    />
  );
}
