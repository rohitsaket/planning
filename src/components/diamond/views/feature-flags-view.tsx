"use client";

import { useApi, apiPost } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface FlagRow {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  description: string | null;
}
interface FlagsData {
  rows: FlagRow[];
}

/** Business names for the flags the application reads; any other flag shows its stored name. */
const FLAG_LABEL: Record<string, string> = {
  FF_COLOR_DIMENSION: "Color categorization",
  FF_CLARITY_DIMENSION: "Clarity categorization",
  FF_TREATMENT_DIMENSION: "Treatment categorization",
  FF_FORECAST_AUTO_ORDER: "Forecast creates production orders",
  FF_PLANNER_SELF_APPROVE: "Planners approve their own plans",
  FF_TRANSFER_AUTO: "Automatic cross-country transfers",
};
const flagLabel = (row: FlagRow) => FLAG_LABEL[row.code] ?? row.name;

function ToggleCell({ row }: { row: FlagRow }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => apiPost("/api/admin/feature-flags", { id: row.id, enabled: !row.enabled }),
    onSuccess: () => {
      toast.success(`${flagLabel(row)} ${!row.enabled ? "enabled" : "disabled"}`);
      qc.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  return (
    <Switch
      checked={row.enabled}
      disabled={mutation.isPending}
      onCheckedChange={() => mutation.mutate()}
      aria-label={`${row.enabled ? "Disable" : "Enable"} ${flagLabel(row)}`}
    />
  );
}

const baseColumns: Column<FlagRow>[] = [
  { key: "setting", header: "Setting", cell: (r) => <span className="text-[10px] font-medium">{flagLabel(r)}</span>, sortable: true, sortValue: (r) => flagLabel(r), exportValue: (r) => flagLabel(r), sticky: "left" },
  { key: "description", header: "Description", cell: (r) => <span className="text-[10px] text-muted-foreground">{r.description ?? r.name}</span> },
  { key: "state", header: "State", align: "center", cell: (r) => <Badge variant={r.enabled ? "success" : "neutral"}>{r.enabled ? "Enabled" : "Disabled"}</Badge> },
];
const toggleColumn: Column<FlagRow> = { key: "toggle", header: "Change", cell: (r) => <ToggleCell row={r} />, align: "center" };

export function FeatureFlagsView() {
  const { data, isLoading } = useApi<FlagsData>("/api/admin/feature-flags");
  const canManage = useAuthStore((s) => !!s.user?.permissions.includes("feature_flag.manage"));

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Feature Flags (Admin)"
        subtitle="Optional dimensions and automated behaviors"
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} flags</span>}
      />

      <InfoBanner variant="warning">
        Color, clarity and treatment categorization stay off until approved by the business.
      </InfoBanner>

      <Section title="Feature Flags">
        <DataTable
          columns={canManage ? [...baseColumns, toggleColumn] : baseColumns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No feature flags defined"
          maxHeight="560px"
          exportable
          exportPermission="config.export"
          exportFilename="feature-flags.csv"
          searchable
          searchPlaceholder="Search settings..."
          searchFn={(r, q) => [flagLabel(r), r.name, r.description ?? ""].some((f) => f.toLowerCase().includes(q.toLowerCase()))}
          pagination
          pageSize={25}
        />
      </Section>
    </div>
  );
}
