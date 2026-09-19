"use client";

import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { useRealtimeStore, type RealtimeEvent } from "@/stores/realtime-store";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";

let socket: Socket | null = null;

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const addEvent = useRealtimeStore((s) => s.addEvent);
  const setConnected = useRealtimeStore((s) => s.setConnected);
  const setEventLog = useRealtimeStore((s) => s.setEventLog);

  const signedIn = useAuthStore((st) => st.status === "signed-in");

  useEffect(() => {
    // The service only accepts sockets that carry a valid session cookie.
    if (!signedIn) {
      socket?.disconnect();
      socket = null;
      setConnected(false);
      return;
    }
    if (socket) return; // singleton — only connect once per session

    // Dev (localhost:3000, no proxy): talk to the service directly. Everywhere else the reverse
    // proxy maps the fixed path /socket.io/* to the service — the client never names a port.
    const isDev = typeof window !== "undefined" && window.location.hostname === "localhost" && window.location.port === "3000";
    const socketUrl = isDev ? "http://localhost:3001" : "/";
    const socketOpts = { path: "/socket.io/", withCredentials: true, transports: ["websocket", "polling"], reconnection: true, reconnectionDelay: 5000, reconnectionAttempts: 20 };

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
  }, [addEvent, setConnected, setEventLog, signedIn]);

  return <>{children}</>;
}
