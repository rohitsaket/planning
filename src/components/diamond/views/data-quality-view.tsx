"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge } from "@/components/diamond/shared/badges";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ISSUE_SEVERITIES,
  ISSUE_SOURCE_LABELS,
  ISSUE_STATUSES,
  ISSUE_TYPE_KEYS,
  issueTypeLabel,
  type IssueTypeOrOther,
} from "@/lib/data-quality/issue-types";

interface IssueRow {
  id: string;
  type: IssueTypeOrOther;
  source: string;
  recordId: string | null;
  message: string;
  severity: string;
  status: string;
  detectedAt: string;
  resolution: string | null;
  resolvedAt: string | null;
}

interface IssuesResponse {
  rows: IssueRow[];
  paging: { page: number; pageSize: number; total: number; hasMore: boolean };
  severityCounts: Record<(typeof ISSUE_SEVERITIES)[number], number>;
  recordedTotal: number;
}

const PAGE_SIZE = 50;
const ALL = "__all";
const titleCase = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");

export function DataQualityView() {
  const [type, setType] = useState(ALL);
  const [severity, setSeverity] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [page, setPage] = useState(1);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (type !== ALL) p.set("type", type);
    if (severity !== ALL) p.set("severity", severity);
    if (status !== ALL) p.set("status", status);
    if (appliedSearch) p.set("search", appliedSearch);
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    return `/api/data-quality?${p.toString()}`;
  }, [type, severity, status, appliedSearch, page, pageSize]);
  const { data, isLoading } = useApi<IssuesResponse>(url);

  const filter = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  const columns: Column<IssueRow>[] = [
    { key: "type", header: "Issue type", width: "13rem", sticky: "left", cell: (r) => <span className="text-xs font-medium">{issueTypeLabel(r.type)}</span>, exportValue: (r) => issueTypeLabel(r.type) },
    { key: "source", header: "Found by", width: "11rem", cell: (r) => <span className="text-xs text-muted-foreground">{ISSUE_SOURCE_LABELS[r.source] ?? "Other"}</span>, exportValue: (r) => ISSUE_SOURCE_LABELS[r.source] ?? "Other" },
    { key: "recordId", header: "Record", width: "10rem", cell: (r) => <span className="font-mono text-[11px]">{r.recordId ?? "Whole feed"}</span> },
    { key: "message", header: "What is wrong", cell: (r) => <span className="text-xs">{r.message}</span> },
    { key: "severity", header: "Severity", align: "center", cell: (r) => <StatusBadge status={r.severity} /> },
    { key: "status", header: "Status", align: "center", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "detectedAt", header: "Detected", align: "center", cell: (r) => <span className="tabular-nums text-[11px]">{new Date(r.detectedAt).toLocaleString()}</span> },
    { key: "resolution", header: "Resolution", cell: (r) => <span className="text-xs text-muted-foreground">{r.resolution ?? "—"}</span> },
  ];

  const counts = data?.severityCounts;
  const nothingRecorded = data?.recordedTotal === 0;

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      <PageHeader title="Import Issues" subtitle="Problems found in planning inputs during synchronization and demand calculation" />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiCard label="Blocking" value={counts?.BLOCKING ?? 0} intent="critical" hint="Stops the affected processing" />
        <KpiCard label="Error" value={counts?.ERROR ?? 0} intent="critical" hint="Record excluded" />
        <KpiCard label="Warning" value={counts?.WARNING ?? 0} intent="warning" hint="Needs review" />
        <KpiCard label="Info" value={counts?.INFO ?? 0} intent="info" />
      </div>

      <Section
        title="Issues"
        description={data ? `${data.paging.total} matching ${data.paging.total === 1 ? "issue" : "issues"}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={type} onValueChange={filter(setType)}>
              <SelectTrigger size="sm" className="h-8 w-[200px] text-xs" aria-label="Issue type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All issue types</SelectItem>
                {ISSUE_TYPE_KEYS.map((key) => <SelectItem key={key} value={key}>{issueTypeLabel(key)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={severity} onValueChange={filter(setSeverity)}>
              <SelectTrigger size="sm" className="h-8 w-[140px] text-xs" aria-label="Severity"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All severities</SelectItem>
                {ISSUE_SEVERITIES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={filter(setStatus)}>
              <SelectTrigger size="sm" className="h-8 w-[140px] text-xs" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {ISSUE_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                maxLength={100}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setAppliedSearch(search.trim()); setPage(1); } }}
                placeholder="Record or message…"
                aria-label="Search issues"
                className="h-8 w-48 pl-7 text-xs"
              />
            </div>
            <Button size="sm" variant="outline" className="h-8" onClick={() => { setAppliedSearch(search.trim()); setPage(1); }}>Apply</Button>
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage={
            nothingRecorded
              ? "No import issues are recorded. Issues are recorded when Fantasy data is synchronized and when demand is calculated."
              : "No issues match the current filters."
          }
          pagination={false}
          exportable
          exportPermission="data_quality.export"
          exportFilename="import-issues.csv"
          exportScope="current-page"
        />
        <ServerPagination
          page={data?.paging.page ?? 1}
          pageSize={data?.paging.pageSize ?? PAGE_SIZE}
          total={data?.paging.total ?? 0}
          hasMore={data?.paging.hasMore ?? false}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          loading={isLoading}
          label="issues"
        />
      </Section>
    </div>
  );
}
