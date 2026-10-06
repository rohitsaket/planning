"use client";

import { create } from "zustand";
import { useAuthStore } from "@/stores/auth-store";
import { useNavStore } from "@/stores/nav-store";
import { Button } from "@/components/ui/button";

const SARIN_MAPPING_VIEW = { view: "admin-mappings", tab: "sarin-shape-mapping" } as const;

export const useMappingIntent = create<{ shape: string | null; setShape: (shape: string | null) => void }>((set) => ({
  shape: null,
  setShape: (shape) => set({ shape }),
}));

export function OpenMappings() {
  const canManage = useAuthStore((s) => !!s.user?.permissions.includes("sarin.mapping.manage"));
  const setView = useNavStore((s) => s.setView);
  if (!canManage) return null;
  return (
    <Button size="sm" variant="outline" className="h-8" onClick={() => setView(SARIN_MAPPING_VIEW.view, SARIN_MAPPING_VIEW.tab)}>
      Open Mappings
    </Button>
  );
}

export function MapShape({ shape }: { shape: string }) {
  const canManage = useAuthStore((s) => !!s.user?.permissions.includes("sarin.mapping.manage"));
  const setView = useNavStore((s) => s.setView);
  const setShape = useMappingIntent((s) => s.setShape);
  if (!canManage) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      aria-label={`Map ${shape}`}
      onClick={() => {
        setShape(shape);
        setView(SARIN_MAPPING_VIEW.view, SARIN_MAPPING_VIEW.tab);
      }}
    >
      Map
    </Button>
  );
}

export function MappingsNotConfigured() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]" role="status">
      <span className="text-amber-700 dark:text-amber-400">Shape mappings are not configured.</span>
      <OpenMappings />
    </div>
  );
}
