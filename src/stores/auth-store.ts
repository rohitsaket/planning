import { create } from "zustand";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
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
