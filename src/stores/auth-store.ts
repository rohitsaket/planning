import { create } from "zustand";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
  /**
   * The countries and labs this session may read. `null` in either list means
   * unrestricted for that dimension.
   *
   * Presentation only: it lets the global filter offer the right options and lets a
   * narrowed page explain why. Every API route resolves the same scope from the session
   * and refuses an out-of-scope request regardless of what the browser holds.
   */
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

// UI convenience only. Every permission is enforced again on the server.
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "loading",
  setUser: (user) => set({ user, status: user ? "signed-in" : "signed-out" }),
}));

export const can = (permission: string) => !!useAuthStore.getState().user?.permissions.includes(permission);

/** The values of one scope dimension this session may read, or null for unrestricted. */
export function authorizedScopeValues(dimension: "countries" | "labs"): string[] | null {
  return useAuthStore.getState().user?.accessScope?.[dimension] ?? null;
}
