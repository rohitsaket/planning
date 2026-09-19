"use client";

import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { useRealtimeStore, type RealtimeEvent } from "@/stores/realtime-store";
import { toast } from "sonner";

let socket: Socket | null = null;

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const addEvent = useRealtimeStore((s) => s.addEvent);
  const setConnected = useRealtimeStore((s) => s.setConnected);
  const setEventLog = useRealtimeStore((s) => s.setEventLog);

  useEffect(() => {
    if (socket) return; // singleton — only connect once

    // In dev (localhost:3000) connect directly to the notifications service.
    // In production (via gateway), use XTransformPort query param.
    const isDev = typeof window !== "undefined" && window.location.hostname === "localhost" && window.location.port === "3000";
    const socketUrl = isDev ? "http://localhost:3001" : "/";
    const socketOpts = isDev
      ? { path: "/socket.io/", transports: ["websocket", "polling"], reconnection: true, reconnectionDelay: 2000 }
      : { path: "/socket.io/", query: { XTransformPort: "3001" }, transports: ["websocket", "polling"], reconnection: true, reconnectionDelay: 2000 };

    socket = io(socketUrl, socketOpts);

    socket.on("connect", () => {
      setConnected(true);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", () => {
      setConnected(false);
    });

    socket.on("event-log", (events: RealtimeEvent[]) => {
      setEventLog(events);
    });

    socket.on("notification", (event: RealtimeEvent) => {
      addEvent(event);
      // Show toast with appropriate severity
      const toastFn =
        event.severity === "success" ? toast.success :
        event.severity === "warning" ? toast.warning :
        event.severity === "error" ? toast.error :
        toast.info;
      toastFn(event.title, {
        description: event.message,
        duration: event.severity === "error" ? 8000 : 5000,
      });
    });

    return () => {
      // Don't disconnect on unmount — keep the singleton alive across navigations
    };
  }, [addEvent, setConnected, setEventLog]);

  return <>{children}</>;
}
