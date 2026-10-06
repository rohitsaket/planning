"use client";

import { create } from "zustand";

interface AccessFocusState {
  focusUserId: string | null;
  setFocusUserId: (id: string | null) => void;
}

export const useAccessFocusStore = create<AccessFocusState>((set) => ({
  focusUserId: null,
  setFocusUserId: (focusUserId) => set({ focusUserId }),
}));
