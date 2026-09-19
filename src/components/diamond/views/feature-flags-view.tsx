"use client";

import { useApi, apiPost } from "@/lib/api-client";
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

function ToggleCell({ row }: { row: FlagRow }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => apiPost("/api/admin/feature-flags", { id: row.id, enabled: !row.enabled, actor: "current.user" }),
    onSuccess: () => {
      toast.success(`${row.code} ${!row.enabled ? "enabled" : "disabled"}`);
      qc.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={row.enabled}
        disabled={mutation.isPending}
        onCheckedChange={() => mutation.mutate()}
      />
      <span className={`text-[10px] ${row.enabled ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>
        {row.enabled ? "ON" : "OFF"}
      </span>
    </div>
  );
}

const columns: Column<FlagRow>[] = [
  { key: "code", header: "Code", cell: (r) => <span className="font-mono text-[10px] font-medium">{r.code}</span>, sortable: true, sortValue: (r) => r.code, sticky: "left" },
  { key: "name", header: "Name", cell: (r) => <span className="text-[10px] font-medium">{r.name}</span> },
  { key: "description", header: "Description", cell: (r) => <span className="text-[10px] text-muted-foreground">{r.description ?? "—"}</span> },
  { key: "state", header: "State", cell: (r) => <Badge variant={r.enabled ? "success" : "neutral"}>{r.enabled ? "ENABLED" : "DISABLED"}</Badge> },
  { key: "toggle", header: "Toggle", cell: (r) => <ToggleCell row={r} />, align: "center" },
];

export function FeatureFlagsView() {
  const { data, isLoading } = useApi<FlagsData>("/api/admin/feature-flags");

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Feature Flags (Admin)"
        subtitle="Controlled toggles for optional dimensions and automated behaviors"
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} flags</span>}
      />

      <InfoBanner variant="warning">
        <strong className="font-semibold">OPEN rule — color/clarity/treatment dimensions are gated:</strong>
        <ul className="mt-1 ml-4 list-disc space-y-0.5">
          <li><span className="font-mono">FF_COLOR_DIMENSION</span>, <span className="font-mono">FF_CLARITY_DIMENSION</span>, <span className="font-mono">FF_TREATMENT_DIMENSION</span> — Color/Clarity/Treatment must NOT automatically become part of the core requirement category until enabled by approved business configuration.</li>
          <li><span className="font-mono">FF_FORECAST_AUTO_ORDER</span> — Predicted future demand must not directly create production orders.</li>
          <li><span className="font-mono">FF_PLANNER_SELF_APPROVE</span> — Configure whether planner can approve own plan.</li>
          <li><span className="font-mono">FF_TRANSFER_AUTO</span> — Automatic cross-country transfers.</li>
        </ul>
      </InfoBanner>

      <Section title="Feature Flag Registry" description="Toggle a flag to enable/disable the behavior (writes an audit entry as current.user)">
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No feature flags defined"
          maxHeight="560px"
          exportable
          exportFilename="feature-flags.csv"
          searchable
          searchPlaceholder="Search by code or name..."
          searchFn={(r, q) => [r.code, r.name, r.description ?? ""].some((f) => f.toLowerCase().includes(q.toLowerCase()))}
        />
      </Section>
    </div>
  );
}
