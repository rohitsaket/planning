"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface SavedView {
  id: string;
  name: string;
  filters: {
    type: string | null;
    status: string | null;
    country: string | null;
    priority: string | null;
    search: string;
  };
  createdAt: string;
}

interface SavedViewsState {
  views: SavedView[];
  addView: (name: string, filters: SavedView["filters"]) => void;
  removeView: (id: string) => void;
  clearAll: () => void;
}

export const useSavedViews = create<SavedViewsState>()(
  persist(
    (set) => ({
      views: [],
      addView: (name, filters) =>
        set((s) => ({
          views: [
            ...s.views,
            {
              id: `sv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name,
              filters,
              createdAt: new Date().toISOString(),
            },
          ],
        })),
      removeView: (id) => set((s) => ({ views: s.views.filter((v) => v.id !== id) })),
      clearAll: () => set({ views: [] }),
    }),
    {
      name: "diamond-erp-saved-views",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
