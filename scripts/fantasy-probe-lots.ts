// Diagnostic for the Fantasy lot listing: tries the known /api/lots resource with the request
// shapes an ASP.NET Web API commonly expects, using the app's cached token. Prints status,
// content type and the first keys of any JSON returned. No credentials are printed.
// Usage: npx tsx --env-file-if-exists=.env scripts/fantasy-probe-lots.ts
import { getFantasyAccessToken, getLiveFantasyConfig, extractRows } from "../src/lib/fantasy/live-api";

async function main() {
  const cfg = getLiveFantasyConfig();
  let t = await getFantasyAccessToken();
  // Fantasy keeps ONE active token per user: a login elsewhere (e.g. the dev server) invalidates ours.
  const probe = await fetch(`${cfg.baseUrl}/api/lots/0`, { headers: { authorization: `Bearer ${t.token}` } });
  if (probe.status === 401) { t = await getFantasyAccessToken({ forceLogin: true }); console.log("cached token was invalidated elsewhere; re-logged in"); }
  const H = { authorization: `Bearer ${t.token}`, accept: "application/json" };
  const show = async (label: string, path: string, init: RequestInit = {}) => {
    try {
      const r = await fetch(`${cfg.baseUrl}${path}`, { ...init, headers: { ...H, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(cfg.timeoutMs) });
      const ct = (r.headers.get("content-type") ?? "").split(";")[0];
      const allow = r.headers.get("allow") ?? r.headers.get("access-control-allow-methods");
      const text = await r.text();
      let note = "";
      try { const j = JSON.parse(text); const rows = extractRows(j) ?? []; note = Array.isArray(j) ? `array(${j.length}) keys=${j[0] ? Object.keys(j[0]).join(",") : ""}` : j === null ? "null" : `object keys=${Object.keys(j).join(",")}${rows.length ? ` rows=${rows.length} rowKeys=${Object.keys(rows[0]).join(",")}` : ""}`; } catch { note = ct.includes("html") ? "html" : "text"; }
      console.log(`${label} -> ${r.status} ${ct}${allow ? ` allow=${allow}` : ""} len=${text.length} :: ${note.slice(0, 700)} :: ${text.slice(0, 160).replace(/\s+/g, " ")}`);
    } catch (e) { console.log(`${label} -> ERR ${e instanceof Error ? e.message : e}`); }
  };
  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  // Grid-style request bodies an ASP.NET Web API POST list action commonly binds to.
  await show("POST /api/lots kendo", "/api/lots", json({ take: 25, skip: 0, page: 1, pageSize: 25, sort: [], filter: { logic: "and", filters: [] } }));
  await show("POST /api/lots devextreme", "/api/lots", json({ skip: 0, take: 25, requireTotalCount: true, sort: null, filter: null }));
  await show("POST /api/lots {model:{}}", "/api/lots", json({ model: { pageIndex: 0, pageSize: 25 } }));
  await show("POST /api/lots {request:{}}", "/api/lots", json({ request: { pageIndex: 0, pageSize: 25 } }));
  await show("GET /api/lots/100", "/api/lots/100");
  await show("GET /api/lots/1000000", "/api/lots/1000000");
  await show("GET /api/lots/8601323", "/api/lots/8601323");
  await show("POST /api/lots {pageIndex,pageSize}", "/api/lots", json({ pageIndex: 0, pageSize: 25 }));
  await show("POST /api/lots {page,pageSize}", "/api/lots", json({ page: 1, pageSize: 25 }));
  await show("POST /api/lots {filter:{}}", "/api/lots", json({ filter: {}, pageIndex: 0, pageSize: 25 }));
  await show("POST /api/lots {criteria:{}}", "/api/lots", json({ criteria: {}, pageIndex: 0, pageSize: 25 }));
  await show("POST /api/lots {lotStatusDB,companyID,pageIndex,pageSize}", "/api/lots", json({ lotStatusDB: "Stock", companyID: 1, pageIndex: 0, pageSize: 25 }));
  await show("POST /api/lots {searchText:''}", "/api/lots", json({ searchText: "", pageIndex: 0, pageSize: 25, sortField: "LotID", sortOrder: "asc" }));
  await show("POST /api/lots form", "/api/lots", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "pageIndex=0&pageSize=25" });
  await show("GET /api/lots?pageIndex=0&pageSize=25&sortField=LotID", "/api/lots?pageIndex=0&pageSize=25&sortField=LotID&sortOrder=asc");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
