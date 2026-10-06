import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { useAuthStore, type SessionUser } from "@/stores/auth-store";
import { call } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";

const API_ROOT = join(process.cwd(), "src", "app", "api");

interface RoutePattern {
  segments: string[];
  file: string;
}

let routes: RoutePattern[] | null = null;

function collectRoutes(dir: string, out: RoutePattern[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectRoutes(full, out);
    else if (name === "route.ts") {
      const rel = relative(API_ROOT, dir);
      out.push({ segments: rel === "" ? [] : rel.split(sep), file: full });
    }
  }
}

function matchRoute(pathname: string): { file: string; params: Record<string, string> } | null {
  if (!routes) {
    routes = [];
    collectRoutes(API_ROOT, routes);
  }
  const parts = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  let best: { file: string; params: Record<string, string>; dynamic: number } | null = null;
  for (const r of routes) {
    if (r.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let dynamic = 0;
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const seg = r.segments[i];
      if (seg.startsWith("[") && seg.endsWith("]")) {
        params[seg.slice(1, -1)] = parts[i];
        dynamic++;
      } else if (seg !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok && (!best || dynamic < best.dynamic)) best = { file: r.file, params, dynamic };
  }
  return best && { file: best.file, params: best.params };
}

export interface RenderedPage {
  html: string;
  text: string;
  requested: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);

export function visibleText(html: string): string {
  const attrs = [...html.matchAll(/\s(?:title|aria-label|placeholder)="([^"]*)"/g)].map((m) => decode(m[1]));
  const body = decode(html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "));
  return `${body} ${attrs.join(" ")}`.replace(/\s+/g, " ").trim();
}

type RouteHandler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export function routeFetch(cookie: string) {
  return async (url: string, init: RequestInit = {}): Promise<Response> => {
    const parsed = new URL(url, "http://localhost:3000");
    const route = matchRoute(parsed.pathname);
    if (!route) throw new Error(`no route module for ${parsed.pathname}`);
    const method = (init.method ?? "GET").toUpperCase();
    const handler = ((await import(pathToFileURL(route.file).href)) as Record<string, RouteHandler | undefined>)[method];
    if (!handler) throw new Error(`no ${method} handler for ${parsed.pathname}`);
    const headers = new Headers(init.headers);
    headers.set("cookie", cookie);
    let body: BodyInit | undefined = init.body ?? undefined;
    if (body instanceof FormData) {
      const encoded = new Response(body);
      const bytes = new Uint8Array(await encoded.arrayBuffer());
      body = bytes;
      headers.set("content-type", encoded.headers.get("content-type")!);
      headers.set("content-length", String(bytes.length));
    }
    resetRateLimits();
    return handler(new Request(parsed.href, { method, headers, body }), { params: Promise.resolve(route.params) });
  };
}

export async function sessionUser(cookie: string): Promise<SessionUser> {
  const { GET } = await import("@/app/api/auth/me/route");
  resetRateLimits();
  const res = await call(GET, { cookie, path: "/api/auth/me" });
  if (res.status !== 200) throw new Error(`session lookup failed (${res.status})`);
  return res.json.user as SessionUser;
}

export async function renderPage<P extends object>(view: ComponentType<P>, props: P, user: SessionUser, cookie: string, maxPasses = 8): Promise<RenderedPage> {
  const element = createElement(view, props);
  const initial = useAuthStore.getInitialState();
  const saved = { user: initial.user, status: initial.status };
  Object.assign(initial, { user, status: "signed-in" as const });
  useAuthStore.getState().setUser(user);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const requested: string[] = [];
  const answered = new Set<string>();
  let html = "";
  try {
    for (let pass = 0; pass < maxPasses; pass++) {
      html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, element));
      const pending = client
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey[0])
        .filter((k): k is string => typeof k === "string" && k.startsWith("/api/") && !answered.has(k));
      if (pending.length === 0) break;
      for (const url of pending) {
        answered.add(url);
        requested.push(url);
        const parsed = new URL(url, "http://localhost:3000");
        const route = matchRoute(parsed.pathname);
        if (!route) throw new Error(`no route module for ${parsed.pathname}`);
        const mod = (await import(pathToFileURL(route.file).href)) as { GET?: Parameters<typeof call>[0] };
        if (!mod.GET) throw new Error(`no GET handler for ${parsed.pathname}`);
        resetRateLimits();
        const res = await call(mod.GET, { cookie, path: `${parsed.pathname}${parsed.search}`, params: route.params });
        const query = client.getQueryCache().find({ queryKey: [url] });
        if (res.status === 200) client.setQueryData([url], res.json);
        else query?.setState({ status: "error", error: new Error(res.json?.error?.message ?? `Request failed (${res.status})`), fetchStatus: "idle" });
      }
    }
  } finally {
    client.clear();
    useAuthStore.getState().setUser(null);
    Object.assign(initial, saved);
  }
  return { html, text: visibleText(html), requested };
}
