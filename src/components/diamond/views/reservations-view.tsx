"use client";

import { useAuthStore } from "@/stores/auth-store";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi, apiPost } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { EmptyState } from "@/components/diamond/shared/empty-state";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Lock, Plus, AlertTriangle } from "lucide-react";
import { packetTypeLabel, packetTypeName } from "@/lib/domain/packet-type";

interface ReservationRow {
  id: string;
  roughId: string;
  fantasyRoughId: string | null;
  stoneName: string | null;
  kapan: string | null;
  packet: string | null;
  roughWeight: number;
  status: string;
  reservedBy: string;
  reservedAt: string;
  releasedAt: string | null;
  caseCode: string | null;
  notes: string | null;
}

interface AvailableRough {
  id: string;
  fantasyRoughId: string | null;
  kapan: string | null;
  packet: string | null;
  stoneName: string | null;
  packetType: string | null;
  roughWeight: number;
  country: string | null;
  branch: string | null;
}

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
};

export function ReservationsView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canReserve = useAuthStore((s) => !!s.user?.permissions.includes("rough.reserve"));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRoughId, setSelectedRoughId] = useState<string>("");

  const { data, isLoading } = useApi<{ rows: ReservationRow[] }>(
    "/api/planning/reservations"
  );
  const rows = data?.rows ?? [];

  // Available roughs to pick from in the new-reservation dialog
  const { data: availData, isLoading: availLoading } = useApi<{ rows: AvailableRough[] }>(
    "/api/planning/rough?planningStatus=AVAILABLE"
  );
  const availableRoughs = availData?.rows ?? [];

  const active = rows.filter((r) => r.status === "RESERVED").length;
  const released = rows.filter((r) => r.status === "RELEASED").length;
  const totalWeight = rows
    .filter((r) => r.status === "RESERVED")
    .reduce((s, r) => s + r.roughWeight, 0);

  const mutation = useMutation({
    mutationFn: async (body: { roughId: string }) =>
      apiPost<{ status: string; reservationId: string }>("/api/planning/reservations", body),
    onSuccess: (resp) => {
      toast({
        title: "Rough Reserved",
        description: "Rough reserved for planning.",
      });
      qc.invalidateQueries({ queryKey: ["/api/planning/reservations"] });
      qc.invalidateQueries({ queryKey: ["/api/planning/rough"] });
      qc.invalidateQueries({ queryKey: ["/api/planning/workbench"] });
      setDialogOpen(false);
      setSelectedRoughId("");
    },
    onError: (e: unknown) => {
      const msg = (e as Error).message;
      if (msg.startsWith("409")) {
        toast({
          title: "Rough already reserved",
          description: "Another planner just reserved this rough. Pick a different stone.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Reservation failed",
          description: msg,
          variant: "destructive",
        });
      }
    },
  });

  const submit = () => {
    if (!selectedRoughId) {
      toast({ title: "Pick a rough first", variant: "destructive" });
      return;
    }
    mutation.mutate({ roughId: selectedRoughId });
  };

  const columns: Column<ReservationRow>[] = [
    {
      key: "fantasyRoughId",
      header: "Fantasy ID",
      width: "130px",
      sticky: "left",
      cell: (r) => <span className="font-medium">{r.fantasyRoughId ?? "—"}</span>,
    },
    {
      key: "stoneName",
      header: "Stone Name",
      align: "center",
      width: "150px",
      cell: (r) => r.stoneName ?? "—",
    },
    {
      key: "kapan",
      header: "Kapan",
      align: "center",
      width: "80px",
      cell: (r) => r.kapan ?? "—",
    },
    {
      key: "packet",
      header: "Packet",
      align: "center",
      width: "70px",
      cell: (r) => r.packet ?? "—",
    },
    {
      key: "roughWeight",
      header: "Weight",
      width: "80px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.roughWeight,
      cell: (r) => <span className="tabular-nums">{r.roughWeight.toFixed(3)}</span>,
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      width: "110px",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "reservedBy",
      header: "Reserved By",
      width: "130px",
      cell: (r) => <span className="text-muted-foreground">{r.reservedBy}</span>,
    },
    {
      key: "reservedAt",
      header: "Reserved At",
      align: "center",
      width: "100px",
      sortable: true,
      sortValue: (r) => r.reservedAt,
      cell: (r) => fmtDate(r.reservedAt),
    },
    {
      key: "releasedAt",
      header: "Released At",
      align: "center",
      width: "100px",
      cell: (r) => fmtDate(r.releasedAt),
    },
    {
      key: "caseCode",
      header: "Case",
      width: "120px",
      cell: (r) => r.caseCode ?? "—",
    },
    {
      key: "notes",
      header: "Notes",
      width: "200px",
      cell: (r) => (
        <span className="text-muted-foreground truncate block max-w-[180px]" title={r.notes ?? ""}>
          {r.notes ?? "—"}
        </span>
      ),
    },
  ];

  const selectedRough = useMemo(
    () => availableRoughs.find((r) => r.id === selectedRoughId) ?? null,
    [availableRoughs, selectedRoughId]
  );

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Rough Reservations"
        subtitle="Reserve rough for planning and track reservations"
        actions={
          canReserve ? (
            <Button size="sm" className="h-8" onClick={() => setDialogOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New Reservation
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Total Reservations" value={rows.length} unit="records" intent="default" />
        <KpiCard label="Active" value={active} unit="stones" intent="warning" />
        <KpiCard label="Released" value={released} unit="stones" intent="success" />
        <KpiCard label="Active Weight" value={totalWeight.toFixed(3)} unit="ct" intent="info" />
      </div>

      {active === 0 && !isLoading && (
        <EmptyState
          title="No active reservations"
          message={canReserve ? "Select New Reservation to reserve an available rough." : "No rough is reserved."}
          icon={<Lock className="h-5 w-5" />}
        />
      )}

      <DataTable<ReservationRow>
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyMessage="No reservation records yet."
        maxHeight="600px"
        searchable
        searchPlaceholder="Search by stone name, kapan, reserver…"
        searchFn={(r, q) => {
          const s = q.toLowerCase();
          return (
            (r.fantasyRoughId ?? "").toLowerCase().includes(s) ||
            (r.stoneName ?? "").toLowerCase().includes(s) ||
            (r.kapan ?? "").toLowerCase().includes(s) ||
            r.reservedBy.toLowerCase().includes(s) ||
            (r.caseCode ?? "").toLowerCase().includes(s)
          );
        }}
        exportable
        exportPermission="plan.export"
        exportFilename="reservations.csv"
        excelExportable
        excelExportFilename="rough-reservations.xlsx"
        initialSortKey="reservedAt"
        initialSortDir="desc"
        pagination
        pageSize={25}
        rowClassName={(r) =>
          r.status === "RESERVED"
            ? "bg-amber-50/40 dark:bg-amber-950/10"
            : ""
        }
      />

      {/* New Reservation Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Lock className="h-4 w-4" />
              New Rough Reservation
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              Pick an available rough to reserve.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rough-select" className="text-[11px]">
                Available rough ({availableRoughs.length})
              </Label>
              <Select
                value={selectedRoughId || "NONE"}
                onValueChange={(v) => setSelectedRoughId(v === "NONE" ? "" : v)}
              >
                <SelectTrigger id="rough-select" className="h-9 text-xs">
                  <SelectValue placeholder="Select a rough…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— Select a rough —</SelectItem>
                  {availableRoughs.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.stoneName ?? r.fantasyRoughId ?? r.id} · {r.kapan ?? "?"}/{r.packet ?? "?"} · {r.roughWeight.toFixed(3)} ct · {r.packetType ? packetTypeLabel(r.packetType) : "?"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availLoading && (
                <p className="text-[10px] text-muted-foreground">Loading available roughs…</p>
              )}
              {!availLoading && availableRoughs.length === 0 && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  No available roughs in stock. Try again later.
                </p>
              )}
            </div>

            {selectedRough && (
              <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px]">
                <div className="grid grid-cols-2 gap-1">
                  <div><span className="text-muted-foreground">Stone Name: </span>{selectedRough.stoneName ?? "—"}</div>
                  <div><span className="text-muted-foreground">Fantasy ID: </span>{selectedRough.fantasyRoughId ?? "—"}</div>
                  <div><span className="text-muted-foreground">Kapan/Packet: </span>{selectedRough.kapan ?? "—"}/{selectedRough.packet ?? "—"}</div>
                  <div><span className="text-muted-foreground">Packet type: </span>{selectedRough.packetType ? packetTypeName(selectedRough.packetType) : "—"}</div>
                  <div><span className="text-muted-foreground">Weight: </span><span className="tabular-nums">{selectedRough.roughWeight.toFixed(3)} ct</span></div>
                  <div><span className="text-muted-foreground">Country: </span>{selectedRough.country ?? "—"}</div>
                </div>
              </div>
            )}

            <div className="rounded-md border border-amber-300 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 p-2">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-amber-800 dark:text-amber-200">
                  The rough stays reserved until it is released.
                </p>
              </div>
            </div>

          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setDialogOpen(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              onClick={submit}
              disabled={!selectedRoughId || mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
                  Reserving…
                </>
              ) : (
                <>
                  <Lock className="h-3 w-3 mr-1" /> Reserve
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
