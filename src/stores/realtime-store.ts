"use client";

import { create } from "zustand";

export interface RealtimeEvent {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
  timestamp: string;
  demoMode?: boolean;
}

interface RealtimeState {
  events: RealtimeEvent[];
  connected: boolean;
  unreadCount: number;
  addEvent: (event: RealtimeEvent) => void;
  setConnected: (connected: boolean) => void;
  clearUnread: () => void;
  setEventLog: (events: RealtimeEvent[]) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  events: [],
  connected: false,
  unreadCount: 0,
  addEvent: (event) =>
    set((s) => ({
      events: [event, ...s.events].slice(0, 50),
      unreadCount: s.unreadCount + 1,
    })),
  setConnected: (connected) => set({ connected }),
  clearUnread: () => set({ unreadCount: 0 }),
  setEventLog: (events) => set({ events }),
}));
