"use client";

import { create } from "zustand";

/**
 * The account the Permissions tab should open on. Set by "Manage Access" on the Users tab
 * and cleared when the inspector is closed. Navigation state only: it grants nothing and
 * every read behind it is authorized by the server.
 */
interface AccessFocusState {
  focusUserId: string | null;
  setFocusUserId: (id: string | null) => void;
}

export const useAccessFocusStore = create<AccessFocusState>((set) => ({
  focusUserId: null,
  setFocusUserId: (focusUserId) => set({ focusUserId }),
}));
