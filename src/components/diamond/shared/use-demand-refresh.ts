"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";

const SNAPSHOT_READS = ["/api/analysis", "/api/demand", "/api/dashboard"];

export function useDemandRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ runId: string; salesCount: number }>("/api/analysis/refresh", {}),
    onSuccess: (r) => {
      toast.success(`Demand recalculated — ${r.salesCount} confirmed sales in the 90-day window`);
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && SNAPSHOT_READS.some((k) => (q.queryKey[0] as string).startsWith(k)) });
    },
    onError: (e) => toast.error(`Demand refresh failed: ${(e as Error).message}`),
  });
}
