import { create } from "zustand";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
  mustChangePassword?: boolean;
  accessScope?: {
    unrestricted: boolean;
    countries: string[] | null;
    labs: string[] | null;
    summary: string;
  };
}

interface AuthState {
  user: SessionUser | null;
  status: "loading" | "signed-out" | "signed-in";
  setUser: (user: SessionUser | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "loading",
  setUser: (user) => set({ user, status: user ? "signed-in" : "signed-out" }),
}));

export const can = (permission: string) => !!useAuthStore.getState().user?.permissions.includes(permission);

export function authorizedScopeValues(dimension: "countries" | "labs"): string[] | null {
  return useAuthStore.getState().user?.accessScope?.[dimension] ?? null;
}
