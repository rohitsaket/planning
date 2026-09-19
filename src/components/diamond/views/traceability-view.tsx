"use client";

import { useState } from "react";
import { useApi } from "@/lib/api-client";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { EmptyState, InfoBanner } from "@/components/diamond/shared/empty-state";
import { Badge, Pill } from "@/components/diamond/shared/badges";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Gem, Diamond, MapPin, ClipboardList, FileText, Layers, CheckCircle,
  ChevronRight, ChevronDown, Search, GitBranch, RefreshCw,
} from "lucide-react";

interface TraceNode {
  kind: "ROUGH" | "REQUIREMENT" | "PLAN" | "PIECE" | "FANTASY_POSITION" | "POLISHED" | "ACTUAL" | string;
  id: string;
  label: string;
  attributes?: Record<string, unknown> | null;
  children?: TraceNode[];
}

interface TracePayload {
  query: string;
  tree: TraceNode;
}

const KIND_ICON: Record<string, React.ReactNode> = {
  ROUGH: <Gem className="h-3.5 w-3.5 text-amber-600" />,
  REQUIREMENT: <ClipboardList className="h-3.5 w-3.5 text-sky-600" />,
  PLAN: <FileText className="h-3.5 w-3.5 text-emerald-600" />,
  PIECE: <Layers className="h-3.5 w-3.5 text-violet-600" />,
  FANTASY_POSITION: <MapPin className="h-3.5 w-3.5 text-rose-600" />,
  POLISHED: <Diamond className="h-3.5 w-3.5 text-cyan-600" />,
  ACTUAL: <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />,
};

const KIND_VARIANT: Record<string, "default" | "critical" | "high" | "medium" | "low" | "info" | "warning" | "success" | "neutral"> = {
  ROUGH: "warning",
  REQUIREMENT: "info",
  PLAN: "success",
  PIECE: "info",
  FANTASY_POSITION: "critical",
  POLISHED: "info",
  ACTUAL: "success",
};

function attrValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "string") {
    // ISO date heuristic
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      try {
        return new Date(v).toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      } catch {
        return v;
      }
    }
    return v;
  }
  return String(v);
}

export function TraceabilityView() {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const url = submitted ? `/api/traceability/${encodeURIComponent(submitted)}` : null;
  const { data, isLoading, isError, error } = useApi<TracePayload>(url);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setSubmitted(q);
  };

  const reset = () => {
    setInput("");
    setSubmitted(null);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Traceability — Bidirectional Genealogy"
        subtitle="Search any token (Rough ID · Kapan · Packet · Stone Name · Plan · Piece · Certificate · Order · Customer) and trace the full genealogy tree"
        actions={
          submitted ? (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={reset}>
              <RefreshCw className="h-3 w-3 mr-1" /> Clear
            </Button>
          ) : undefined
        }
      />

      <InfoBanner variant="info">
        <div className="flex items-start gap-2">
          <GitBranch className="h-3.5 w-3.5 mt-0.5" />
          <div>
            <p className="font-medium">Bidirectional genealogy: Fantasy Rough → Planning Case → Selected Plan → Planned Pieces → Fantasy Children → Final Fantasy Polished Lots AND reverse.</p>
            <p className="text-muted-foreground mt-0.5">Every node links forward to its descendants and backward to its ancestors — no orphan records, no silent breaks.</p>
          </div>
        </div>
      </InfoBanner>

      {/* Search */}
      <Section title="Search" description="Enter any traceable identifier and press Enter to traverse the genealogy tree">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xl">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. ROUGH-001, Kapan-IND-001, PC-2024-001, GIA-12345..."
              className="h-9 pl-7 text-sm"
              autoFocus
            />
          </div>
          <Button type="submit" size="sm" className="h-9 text-xs" disabled={!input.trim()}>
            <Search className="h-3.5 w-3.5 mr-1" /> Trace
          </Button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["ROUGH", "POLISHED", "PC-2024", "GIA", "Blue", "1.5ct"].map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => { setInput(tag); setSubmitted(tag); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/40 hover:bg-muted text-muted-foreground"
            >
              {tag}
            </button>
          ))}
        </div>
      </Section>

      {/* Result */}
      <Section
        title="Genealogy Tree"
        description={submitted ? `Query: "${submitted}"` : "Submit a search to display the tree"}
        actions={data?.tree ? <Pill><Layers className="h-3 w-3" /> {data.tree.kind}</Pill> : undefined}
      >
        {!submitted && (
          <EmptyState
            title="No search submitted"
            message="Enter a traceable identifier above to traverse the bidirectional genealogy tree."
            icon={<Search className="h-6 w-6" />}
          />
        )}
        {submitted && isLoading && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" /> Tracing genealogy...
          </div>
        )}
        {submitted && isError && (
          <EmptyState
            title="No matching entity found"
            message={`No entity matches "${submitted}". ${(error as Error)?.message ?? ""}`.trim()}
            icon={<Search className="h-6 w-6" />}
          />
        )}
        {submitted && data?.tree && (
          <div className="rounded-md border border-border bg-card p-3 max-h-[600px] overflow-y-auto">
            <TreeNode node={data.tree} depth={0} />
          </div>
        )}
      </Section>
    </div>
  );
}

function TreeNode({ node, depth = 0 }: { node: TraceNode; depth?: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = !!node.children && node.children.length > 0;
  const icon = KIND_ICON[node.kind] ?? <Layers className="h-3.5 w-3.5 text-muted-foreground" />;
  const variant = KIND_VARIANT[node.kind] ?? "default";
  const attrEntries = node.attributes ? Object.entries(node.attributes) : [];

  return (
    <div style={{ marginLeft: depth * 16 }} className="border-l border-border/40 pl-2 last:border-0">
      <div className="flex items-start gap-2 py-1.5">
        <button
          type="button"
          onClick={() => hasChildren && setOpen(!open)}
          className={`mt-0.5 ${hasChildren ? "cursor-pointer" : "cursor-default opacity-30"}`}
          aria-label={hasChildren ? (open ? "Collapse" : "Expand") : "No children"}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
          ) : (
            <span className="inline-block h-3 w-3" />
          )}
        </button>
        <span className="mt-0.5">{icon}</span>
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs font-medium break-words">{node.label}</p>
            <Badge variant={variant}>{node.kind.replace(/_/g, " ")}</Badge>
          </div>
          {attrEntries.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5 mt-0.5">
              {attrEntries.map(([k, v]) => (
                <div key={k} className="text-[10px]">
                  <span className="text-muted-foreground">{k}:</span>{" "}
                  <span className="font-medium tabular-nums">{attrValue(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {hasChildren && open && (
        <div className="ml-1">
          {node.children!.map((c, i) => (
            <TreeNode key={`${c.id}-${i}`} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
