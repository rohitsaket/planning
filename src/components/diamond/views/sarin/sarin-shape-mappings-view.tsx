"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { formatIST } from "@/lib/fantasy/time";
import { SARIN_ECOSYSTEM_SHAPES } from "@/lib/sarin/domain";

const FANTASY_SHAPE_OPTIONS = [...SARIN_ECOSYSTEM_SHAPES].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
import { Section } from "@/components/diamond/shared/page-header";
import { EmptyState, InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { packetTypeName } from "@/lib/domain/packet-type";
import { SarinLoadError } from "./sarin-load-error";
import { useMappingIntent } from "./sarin-mapping-links";

const API = "/api/planning/sarin/shape-mappings";

type ApplyTo = "ALL_RATIOS" | "RATIO_RANGE";
interface MappingRow {
  id: string;
  sarinShape: string;
  fantasyShape: string;
  fantasyCode: string | null;
  applyTo: ApplyTo;
  minimumRatio: string | null;
  maximumRatio: string | null;
  note: string | null;
  updatedAt: string;
  updatedBy: string | null;
}
interface ShapeNeedingMapping {
  sarinShape: string;
  packetTypes: string[];
  records: number;
  observedRatio: { lowest: string; highest: string } | null;
}
interface Catalog {
  configured: boolean;
  mappings: MappingRow[];
  needsMapping: ShapeNeedingMapping[];
  partialCounts: boolean;
  unconfirmed: string[];
}

type Show = "ALL" | "MAPPED" | "NEEDS_MAPPING";

const appliesTo = (r: Pick<MappingRow, "applyTo" | "minimumRatio" | "maximumRatio">) => {
  if (r.applyTo === "ALL_RATIOS") return "All ratios";
  if (r.minimumRatio && r.maximumRatio) return `Ratio ${r.minimumRatio}–${r.maximumRatio}`;
  if (r.minimumRatio) return `Ratio ${r.minimumRatio} and above`;
  return `Ratio up to ${r.maximumRatio}`;
};

export function SarinShapeMappingsView() {
  const canManage = useAuthStore((s) => !!s.user?.permissions.includes("sarin.mapping.manage"));
  const queryClient = useQueryClient();
  const catalog = useApi<Catalog>(API);
  const [form, setForm] = useState<FormValues | null>(() => {
    const shape = useMappingIntent.getState().shape;
    return shape && canManage ? { ...EMPTY_FORM, sarinShape: shape } : null;
  });
  const [show, setShow] = useState<Show>("ALL");
  const [removing, setRemoving] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/planning/sarin/") });

  useEffect(() => {
    if (useMappingIntent.getState().shape) useMappingIntent.getState().setShape(null);
  }, []);

  const data = catalog.data;
  const mappings = useMemo(() => data?.mappings ?? [], [data]);

  const remove = async (id: string) => {
    try {
      const res = await fetch(`${API}/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "Mapping could not be saved");
      toast.success("Mapping removed");
      setRemoving(null);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Sarin Shape Mapping</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={show} onValueChange={(v) => setShow(v as Show)}>
            <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="Show"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs">All</SelectItem>
              <SelectItem value="MAPPED" className="text-xs">Mapped</SelectItem>
              <SelectItem value="NEEDS_MAPPING" className="text-xs">Needs Mapping</SelectItem>
            </SelectContent>
          </Select>
          {canManage && !form && (
            <Button size="sm" className="h-8" onClick={() => setForm(EMPTY_FORM)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add Mapping
            </Button>
          )}
        </div>
      </div>

      {catalog.isLoading ? (
        <p className="px-1 text-[11px] text-muted-foreground" role="status">Loading mappings…</p>
      ) : catalog.error || !data ? (
        <SarinLoadError what="Shape mappings" error={catalog.error} retrying={catalog.isFetching} onRetry={() => void catalog.refetch()} />
      ) : (
        <>
          {!data.configured && <InfoBanner variant="warning">Shape mappings are not configured.</InfoBanner>}

          {form && (
            <MappingForm
              initial={form}
              onCancel={() => setForm(null)}
              onSaved={async () => {
                setForm(null);
                await refresh();
              }}
            />
          )}

          {show !== "MAPPED" && data.needsMapping.length > 0 && (
            <Section title="Needs Mapping" description="These shapes do not have a mapping yet." bodyClassName="p-2">
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[600px] border-collapse text-xs">
                  <thead className="border-b border-border bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left" scope="col">Sarin shape</th>
                      <th className="px-2 py-1.5 text-left" scope="col">Packet Type</th>
                      <th className="px-2 py-1.5 text-right" scope="col">Records</th>
                      <th className="px-2 py-1.5 text-left" scope="col">Observed ratio</th>
                      {canManage && <th className="px-2 py-1.5 text-left" scope="col">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.needsMapping.map((s) => (
                      <tr key={s.sarinShape} className="border-b border-border/40 last:border-0">
                        <td className="px-2 py-1.5 font-mono text-[11px]">{s.sarinShape}</td>
                        <td className="px-2 py-1.5">{s.packetTypes.length ? s.packetTypes.map(packetTypeName).join(", ") : "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{s.records.toLocaleString("en-IN")}</td>
                        <td className="px-2 py-1.5 tabular-nums">{s.observedRatio ? `${s.observedRatio.lowest}–${s.observedRatio.highest}` : "—"}</td>
                        {canManage && (
                          <td className="px-2 py-1.5">
                            <Button size="sm" variant="outline" className="h-7" aria-label={`Map ${s.sarinShape}`} onClick={() => setForm({ ...EMPTY_FORM, sarinShape: s.sarinShape })}>
                              Map
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.partialCounts && <p className="mt-1 px-1 text-[11px] text-muted-foreground">Counts are partial.</p>}
            </Section>
          )}
          {show === "NEEDS_MAPPING" && data.needsMapping.length === 0 && <EmptyState title="Every imported shape has a mapping" />}

          {show !== "MAPPED" && data.unconfirmed.length > 0 && (
            <Section title="Unconfirmed mappings" description="These shapes need a mapping confirmed by the client." bodyClassName="p-2">
              <ul className="flex flex-wrap gap-2" aria-label="Unconfirmed mappings">
                {data.unconfirmed.map((shape) => (
                  <li key={shape} className="flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-[11px]">
                    <span className="font-mono">{shape}</span>
                    {canManage && (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" aria-label={`Map ${shape}`} onClick={() => setForm({ ...EMPTY_FORM, sarinShape: shape })}>
                        Map
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {show !== "NEEDS_MAPPING" && (
            <Section title="Current mappings" bodyClassName="p-2">
              {mappings.length === 0 ? (
                <EmptyState title="No mappings yet" message={canManage ? "Use Add Mapping to create the first one." : undefined} />
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[680px] border-collapse text-xs">
                    <thead className="border-b border-border bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 text-left" scope="col">Sarin shape</th>
                        <th className="px-2 py-1.5 text-left" scope="col">Code</th>
                        <th className="px-2 py-1.5 text-left" scope="col">Fantasy shape</th>
                        <th className="px-2 py-1.5 text-left" scope="col">Applies to</th>
                        <th className="px-2 py-1.5 text-left" scope="col">Updated</th>
                        {canManage && <th className="px-2 py-1.5 text-left" scope="col">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {mappings.map((r) => (
                        <tr key={r.id} className="border-b border-border/40 last:border-0">
                          <td className="px-2 py-1.5 font-mono text-[11px]">{r.sarinShape}</td>
                          <td className="px-2 py-1.5 font-mono text-[11px]">{r.fantasyCode ?? <span className="font-sans text-muted-foreground" title="The Fantasy code for this shape is not confirmed yet">Not confirmed</span>}</td>
                          <td className="px-2 py-1.5">{r.fantasyShape}</td>
                          <td className="px-2 py-1.5">
                            {appliesTo(r)}
                            {r.note && <span className="block text-[10px] text-muted-foreground">{r.note}</span>}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {formatIST(r.updatedAt, false)}
                            {r.updatedBy ? ` · ${r.updatedBy}` : ""}
                          </td>
                          {canManage && (
                            <td className="px-2 py-1.5">
                              {removing === r.id ? (
                                <span className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Remove mapping for ${r.sarinShape}`}>
                                  <span>Remove this mapping?</span>
                                  <Button size="sm" variant="destructive" className="h-7 px-2" onClick={() => void remove(r.id)}>Remove</Button>
                                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setRemoving(null)}>Cancel</Button>
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2"
                                    aria-label={`Edit mapping for ${r.sarinShape}, ${appliesTo(r)}`}
                                    onClick={() => setForm({ ruleId: r.id, sarinShape: r.sarinShape, fantasyShape: r.fantasyShape, applyTo: r.applyTo, minimumRatio: r.minimumRatio ?? "", maximumRatio: r.maximumRatio ?? "", note: r.note ?? "" })}
                                  >
                                    <Pencil className="mr-1 h-3 w-3" aria-hidden /> Edit
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={`Remove mapping for ${r.sarinShape}, ${appliesTo(r)}`} onClick={() => setRemoving(r.id)}>
                                    <Trash2 className="h-3 w-3" aria-hidden />
                                  </Button>
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

interface FormValues {
  ruleId?: string;
  sarinShape: string;
  fantasyShape: string;
  applyTo: ApplyTo;
  minimumRatio: string;
  maximumRatio: string;
  note: string;
}
const EMPTY_FORM: FormValues = { sarinShape: "", fantasyShape: "", applyTo: "ALL_RATIOS", minimumRatio: "", maximumRatio: "", note: "" };
type Field = "sarinShape" | "fantasyShape" | "ratio" | "form";
const DECIMAL = /^\d{1,3}(\.\d{1,3})?$/;

function MappingForm({ initial, onCancel, onSaved }: { initial: FormValues; onCancel: () => void; onSaved: () => Promise<void> }) {
  const ids = useId();
  const [v, setV] = useState<FormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  const set = <K extends keyof FormValues>(k: K, value: FormValues[K]) => {
    setV((prev) => ({ ...prev, [k]: value }));
    setError(null);
  };
  const range = v.applyTo === "RATIO_RANGE";

  const save = async () => {
    if (!v.sarinShape.trim()) return setError({ field: "sarinShape", message: "Enter a Sarin shape" });
    if (!v.fantasyShape) return setError({ field: "fantasyShape", message: "Choose a valid Fantasy shape" });
    const badRange =
      range &&
      ((!v.minimumRatio && !v.maximumRatio) ||
        (v.minimumRatio && !DECIMAL.test(v.minimumRatio)) ||
        (v.maximumRatio && !DECIMAL.test(v.maximumRatio)) ||
        (v.minimumRatio && v.maximumRatio && Number(v.minimumRatio) > Number(v.maximumRatio)));
    if (badRange) return setError({ field: "ratio", message: "Enter a valid ratio range" });
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...(v.ruleId ? { ruleId: v.ruleId } : {}),
        sarinShape: v.sarinShape.trim(),
        fantasyShape: v.fantasyShape,
        applyTo: v.applyTo,
        minimumRatio: range && v.minimumRatio ? v.minimumRatio : null,
        maximumRatio: range && v.maximumRatio ? v.maximumRatio : null,
        note: v.note.trim() || null,
      };
      const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError({ field: (json?.error?.details?.field as Field | undefined) ?? "form", message: json?.error?.message ?? "Mapping could not be saved" });
        return;
      }
      toast.success("Mapping saved");
      await onSaved();
    } catch {
      setError({ field: "form", message: "Mapping could not be saved" });
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (f: Field) =>
    error?.field === f ? (
      <p id={`${ids}-${f}-error`} className="text-[11px] text-rose-700 dark:text-rose-400" role="alert">{error.message}</p>
    ) : null;

  return (
    <Section title={v.ruleId ? "Edit Mapping" : "Add Mapping"}>
      <form
        className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6"
        aria-label={v.ruleId ? "Edit mapping" : "Add mapping"}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-sarin`} className="text-xs">Sarin shape</Label>
          <Input id={`${ids}-sarin`} value={v.sarinShape} maxLength={128} disabled={busy} onChange={(e) => set("sarinShape", e.target.value)} aria-invalid={error?.field === "sarinShape"} aria-describedby={error?.field === "sarinShape" ? `${ids}-sarinShape-error` : undefined} className="h-9 text-xs" />
          {fieldError("sarinShape")}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-fantasy`} className="text-xs">Fantasy shape</Label>
          <Select value={v.fantasyShape} onValueChange={(x) => set("fantasyShape", x)} disabled={busy}>
            <SelectTrigger id={`${ids}-fantasy`} className="h-9 text-xs" aria-label="Fantasy shape" aria-invalid={error?.field === "fantasyShape"} aria-describedby={error?.field === "fantasyShape" ? `${ids}-fantasyShape-error` : undefined}>
              <SelectValue placeholder="Choose a shape" />
            </SelectTrigger>
            <SelectContent>
              {FANTASY_SHAPE_OPTIONS.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
            </SelectContent>
          </Select>
          {fieldError("fantasyShape")}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-apply`} className="text-xs">Applies to</Label>
          <Select value={v.applyTo} onValueChange={(x) => set("applyTo", x as ApplyTo)} disabled={busy}>
            <SelectTrigger id={`${ids}-apply`} className="h-9 text-xs" aria-label="Applies to"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL_RATIOS" className="text-xs">All ratios</SelectItem>
              <SelectItem value="RATIO_RANGE" className="text-xs">Ratio range</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {range && (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-min`} className="text-xs">Minimum ratio</Label>
              <Input id={`${ids}-min`} value={v.minimumRatio} inputMode="decimal" placeholder="e.g. 1.000" disabled={busy} onChange={(e) => set("minimumRatio", e.target.value.trim())} aria-invalid={error?.field === "ratio"} aria-describedby={error?.field === "ratio" ? `${ids}-ratio-error` : undefined} className="h-9 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-max`} className="text-xs">Maximum ratio</Label>
              <Input id={`${ids}-max`} value={v.maximumRatio} inputMode="decimal" placeholder="e.g. 1.030" disabled={busy} onChange={(e) => set("maximumRatio", e.target.value.trim())} aria-invalid={error?.field === "ratio"} aria-describedby={error?.field === "ratio" ? `${ids}-ratio-error` : undefined} className="h-9 text-xs" />
            </div>
          </>
        )}
        <div className={range ? "flex flex-col gap-1 xl:col-span-6" : "flex flex-col gap-1 xl:col-span-3"}>
          <Label htmlFor={`${ids}-note`} className="text-xs">Note</Label>
          <Input id={`${ids}-note`} value={v.note} maxLength={500} placeholder="Optional" disabled={busy} onChange={(e) => set("note", e.target.value)} className="h-9 text-xs" />
        </div>
        {range && error?.field === "ratio" && <div className="xl:col-span-6">{fieldError("ratio")}</div>}
        <div className="flex flex-wrap items-center gap-2 xl:col-span-6">
          <Button type="submit" size="sm" className="h-8" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : "Save Mapping"}</Button>
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={busy} onClick={onCancel}>Cancel</Button>
        </div>
        {error?.field === "form" && <div className="xl:col-span-6" role="alert"><InfoBanner variant="critical">{error.message}</InfoBanner></div>}
      </form>
    </Section>
  );
}
