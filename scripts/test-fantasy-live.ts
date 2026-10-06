import { decryptSecret, encryptSecret, generateSecretsKey, isEncryptedSecret } from "../src/lib/security/secrets";
import { mapFantasyRow, mapFantasyRows, parseFantasyDate, resolveStatus } from "../src/lib/fantasy/live-mapper";
import { LiveFantasyProvider } from "../src/lib/fantasy/provider";
import { validateCanonicalRecord } from "../src/lib/fantasy/canonical";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`❌ FAILED: ${msg}`); throw new Error(msg); }
  passed++; console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log("--- 1. Encrypted secrets ---");
  const key = generateSecretsKey();
  const env = encryptSecret("Sv$$example#pw", key);
  assert(isEncryptedSecret(env) && env.startsWith("enc:v1:"), "encryptSecret produces an enc:v1 envelope");
  assert(decryptSecret(env, key) === "Sv$$example#pw", "decryptSecret round-trips the plaintext (with $ and #)");
  assert(encryptSecret("x", key) !== encryptSecret("x", key), "fresh IV per encryption (same plaintext → different envelopes)");
  assert(decryptSecret("plain-value", key) === "plain-value", "a plaintext value passes through unchanged");
  let threw = false; try { decryptSecret(env, generateSecretsKey()); } catch { threw = true; }
  assert(threw, "wrong SECRETS_KEY is rejected (auth tag)");
  threw = false; try { encryptSecret("x", "short"); } catch { threw = true; }
  assert(threw, "a key that is not 32 bytes is rejected");

  console.log("\n--- 2. Row mapper ---");
  const ctx = { batchId: "B-1", checkpoint: 1, cutoff: new Date("2026-09-22T10:00:00Z"), defaultCountry: "IN", defaultBranch: "SURAT" };
  const stock = mapFantasyRow({ "Lot ID": "L-100", "Lot Name": "2501-001 HA", "Lot Status DB": "Stock", Shape: "ROUND", Color: "F", Clarity: "VS1", Weight: "1.05", "Lab Name": "GIA", "Certificate No": "GIA-1", "Doc Date": "15-08-2026", "Department Account Name": "Surat Vault", "Company ID": "FDH", Qty: 1, Cut: "EX", Polish: "EX", Sym: "EX", "Fluo.": "NON", Table: 57, Depth: 61.5, Ratio: 1.0, ItemName: "Polished Diamond" }, ctx);
  assert(!("skip" in stock), "a stock row maps to a canonical record");
  if ("skip" in stock) return;
  assert(stock.lotId === "L-100" && stock.currentStatus === "STOCK" && stock.entityType === "POLISHED" && stock.roughOrPolished === "POLISHED" && stock.isCurrent, "Stock → STOCK / POLISHED / live");
  assert(stock.weight === 1.05 && stock.shape === "ROUND" && stock.labRaw === "GIA" && stock.certificate === "GIA-1" && stock.color === "F" && stock.clarity === "VS1", "weight, shape, lab, certificate, color, clarity mapped");
  assert(stock.docDate === "2026-08-15T00:00:00.000Z", "dd-MM-yyyy Doc Date parsed as UTC calendar date");
  assert(stock.departmentName === "Surat Vault" && stock.branch === "FDH" && stock.country === "IN", "department name, Company ID → branch, default country");
  assert(stock.sourceType === "FANTASY_API" && stock.isSimulated === false && stock.syncBatchId === "B-1" && stock.checkpoint === 1, "source/batch/checkpoint stamped, not simulated");
  assert(stock.stoneName === "2501-001 HA" && stock.quantity === 1, "Lot Name → stoneName, Qty → quantity");
  const raw = (stock.metadata as { raw: Record<string, unknown> }).raw;
  assert(raw.Cut === "EX" && raw.Table === 57 && raw["Fluo."] === "NON", "columns without a canonical field are kept in metadata.raw");
  assert(validateCanonicalRecord(stock).valid, "mapped stock record passes canonical validation");

  const sold = mapFantasyRow({ lotId: "L-200", lotStatusDB: "Sold", shape: "OVAL", weight: 2.1, docDate: "2026-09-10T00:00:00Z", "Allocation Account ID": "CUST-7" }, ctx);
  assert(!("skip" in sold) && sold.currentStatus === "SOLD" && sold.entityType === "INVOICE" && !sold.isCurrent && sold.removalReason === "EXPLICIT_SALE" && sold.customerCode === "CUST-7", "Sold (camelCase headers) → SOLD / INVOICE / not current / EXPLICIT_SALE");
  const inv = mapFantasyRow({ "LOT_ID": "L-201", "LOT_STATUS_DB": "Invoice", SHAPE: "PEAR", WEIGHT: 1.2 }, ctx);
  assert(!("skip" in inv) && inv.currentStatus === "INVOICE" && !inv.isCurrent && inv.removalReason === "EXPLICIT_SALE", "Invoice (UPPER_SNAKE headers) → INVOICE / not current");
  const memo = mapFantasyRow({ "Lot ID": "L-300", "Lot Status DB": "Memo", Shape: "CUSHION", Weight: 1.5 }, ctx);
  assert(!("skip" in memo) && memo.currentStatus === "MEMO" && memo.entityType === "MEMO" && memo.isCurrent, "Memo → MEMO, still live");
  const wip = mapFantasyRow({ "Lot ID": "W-1", "Lot Status DB": "In Process", "Process Name": "Laser Sawing", Shape: "ROUND", Weight: 2.3 }, ctx);
  assert(!("skip" in wip) && wip.currentStatus === "WIP_LASER" && wip.entityType === "WIP" && wip.roughOrPolished === "WIP" && wip.wipStage === "Laser Sawing", "Process Name 'Laser Sawing' → WIP_LASER");
  assert(resolveStatus("Stock", "Polishing", null).status === "STOCK", "an explicit Stock status wins over a process name");
  assert(resolveStatus("", "Final Polish", null).status === "WIP_POLISHING", "blank status with a process name → WIP stage by keyword");
  const rough = mapFantasyRow({ "Lot ID": "R-1", "Lot Status DB": "Stock", ItemName: "Rough Diamond", "Original Weight": 4.85, "Lot Name": "STN-485-A" }, ctx);
  assert(!("skip" in rough) && rough.roughOrPolished === "ROUGH" && rough.entityType === "ROUGH" && rough.weight === 4.85 && rough.shape === "ROUGH", "ItemName 'Rough Diamond' → ROUGH, Original Weight used, shape placeholder so validation passes");
  assert(!("skip" in rough) && validateCanonicalRecord(rough).valid, "mapped rough record passes canonical validation");
  const skipped = mapFantasyRow({ "Lot Name": "no id", Weight: 1 }, ctx);
  assert("skip" in skipped && /Lot ID/.test(skipped.skip), "a row without Lot ID is skipped with a reason");
  const noDate = mapFantasyRow({ "Lot ID": "L-400", Weight: 1, Shape: "ROUND", "Doc Date": "not a date" }, ctx);
  assert(!("skip" in noDate) && noDate.docDate === ctx.cutoff.toISOString(), "unparseable Doc Date falls back to the batch cutoff");
  const noon = Date.UTC(2026, 8, 22, 12);
  assert(parseFantasyDate(`/Date(${noon})/`)?.toISOString() === "2026-09-22T12:00:00.000Z", "ASP.NET /Date(ms)/ format parsed");
  assert(parseFantasyDate("22/09/2026 14:05")?.toISOString() === "2026-09-22T14:05:00.000Z", "dd/MM/yyyy HH:mm parsed");
  const batch = mapFantasyRows([{ "Lot ID": "A" , Weight: 1, Shape: "ROUND" }, { Weight: 2 }, { "Lot ID": "B", Weight: 1, Shape: "OVAL" }], ctx);
  assert(batch.records.length === 2 && batch.skipped.length === 1 && batch.skipped[0].index === 1, "mapFantasyRows keeps mappable rows and reports skipped indexes");

  console.log("\n--- 3. Live provider ---");
  const rows = [
    { "Lot ID": "L-1", "Lot Status DB": "Stock", Shape: "ROUND", Weight: 1.01 },
    { "Lot ID": "L-2", "Lot Status DB": "Memo", Shape: "OVAL", Weight: 1.5 },
    { "Lot ID": "L-3", "Lot Status DB": "Sold", Shape: "PEAR", Weight: 0.9 },
  ];
  let fetches = 0;
  const provider = new LiveFantasyProvider({
    fetchLots: async () => { fetches++; return rows; },
    listCurrentLotIds: async () => ["L-1", "L-2", "L-OLD"],
    defaultCountry: "IN", defaultBranch: "SURAT",
    now: () => new Date("2026-09-22T10:30:00Z"),
  });
  assert(provider.getSourceMode() === "FANTASY_API", "provider reports FANTASY_API");
  const b = await provider.getBatch(7);
  assert(!!b && b.startingCheckpoint === 7 && b.endingCheckpoint === 8, "checkpoint advances by exactly one");
  if (!b) return;
  assert(b.isSimulated === false && b.sourceMode === "FANTASY_API", "batch is a live (non-simulated) FANTASY_API batch");
  assert(b.records.length === 3 && b.records.every((r) => r.checkpoint === 8 && r.syncBatchId === b.batchId), "all listed lots become records stamped with the batch");
  assert(b.removals.length === 1 && b.removals[0].lotId === "L-OLD" && b.removals[0].removalReason === "SOURCE_DISAPPEARANCE_UNKNOWN", "a live lot missing from the snapshot becomes SOURCE_DISAPPEARANCE_UNKNOWN (never a sale)");
  assert(!b.removals.some((r) => r.lotId === "L-3"), "a lot reported Sold by the listing is NOT also a disappearance removal");
  assert(b.batchId === "FANTASY-API-2026-09-22T10-30-00-000Z" && b.sourceCutoff === "2026-09-22T10:30:00.000Z", "batch id and cutoff derive from the snapshot time");
  assert((b.metadata as { fetchedRows: number }).fetchedRows === 3 && fetches === 1, "one fetch per batch, row count recorded");

  console.log(`\n🎉 ALL FANTASY LIVE INTEGRATION CHECKS PASSED (${passed})`);
}
main().then(() => part2()).then(() => part3()).catch((e) => { console.error(e); process.exit(1); });

import { getLiveFantasyConfig, validateFantasyConfigForLog } from "../src/lib/fantasy/config";
import { redact, redactString, safeErrorMessage } from "../src/lib/security/redact";
import { createFantasyClient, FantasyApiError, memoryTokenStore, retryDelayMs, type LiveFantasyConfig } from "../src/lib/fantasy/live-api";
import { LIVE_LOT_FIELDS } from "../src/lib/fantasy/live-fields";
import { contentHashOf, mapLiveLot, mapLiveLotRows, mappingMatrix, stableRecordKey, toBoolean, toDecimalString } from "../src/lib/fantasy/live-mapper";

async function part2() {
  console.log("\n--- 4. Configuration validation (names only, never values) ---");
  const saved = { ...process.env };
  process.env.FANTASY_API_BASE_URL = ""; process.env.FANTASY_API_USERNAME = ""; process.env.FANTASY_API_PASSWORD = "";
  let cfg = getLiveFantasyConfig();
  assert(!cfg.configured && cfg.missing.includes("FANTASY_API_BASE_URL") && cfg.missing.includes("FANTASY_API_USERNAME") && cfg.missing.includes("FANTASY_API_PASSWORD"), "missing variables are named");
  process.env.FANTASY_API_BASE_URL = "http://insecure.example"; process.env.FANTASY_API_USERNAME = "u"; process.env.FANTASY_API_PASSWORD = "p";
  cfg = getLiveFantasyConfig();
  assert(!cfg.configured && cfg.missing.some((m) => /https/.test(m)), "a non-https base URL is rejected");
  process.env.FANTASY_API_BASE_URL = "https://skylab.fantasy.mn:7600/"; process.env.FANTASY_SYNC_INTERVAL_MINUTES = "5"; process.env.FANTASY_SYNC_ENABLED = "true"; process.env.FANTASY_SYNC_MAX_RETRIES = "3"; process.env.FANTASY_SYNC_PAGE_SIZE = "500";
  cfg = getLiveFantasyConfig();
  assert(cfg.configured && cfg.baseUrl === "https://skylab.fantasy.mn:7600" && cfg.syncIntervalMinutes === 5 && cfg.syncEnabled && cfg.maxRetries === 3 && cfg.pageSize === 500, "valid configuration parsed, trailing slash trimmed");
  const summary = validateFantasyConfigForLog();
  assert(summary.usernameConfigured === true && summary.passwordConfigured === true && !JSON.stringify(summary).includes("p\"") && !("username" in summary), "startup summary reports configured flags, not values");
  process.env = saved;

  console.log("\n--- 5. Redaction ---");
  assert(redactString("Authorization: Bearer abc.def-ghi") === "Authorization: Bearer <redacted>", "bearer tokens masked in strings");
  assert(redactString("login failed password=Sv$$1 user=x") === "login failed password=<redacted> user=x", "password=… fragments masked");
  const red = redact({ headers: { Authorization: "Bearer x", cookie: "a=b", accept: "json" }, body: { password: "p", username: "u", nested: { access_token: "t", tokenEnc: "e" } } });
  assert(red.headers.Authorization === "<redacted>" && red.headers.cookie === "<redacted>" && red.headers.accept === "json" && red.body.password === "<redacted>" && red.body.username === "u" && red.body.nested.access_token === "<redacted>" && red.body.nested.tokenEnc === "<redacted>", "credential-looking keys masked, others kept");
  assert(safeErrorMessage(new Error("HTTP 500 bearer ZZZ token=abc")) === "HTTP 500 Bearer <redacted> token=<redacted>", "error messages are redacted");

  console.log("\n--- 6. Client: auth, retries, no-retry on 401, 429 Retry-After, pagination ---");
  const base: LiveFantasyConfig = { ...getLiveFantasyConfig(), configured: true, missing: [], baseUrl: "https://f.example", username: "u", usernameConfigured: true, passwordConfigured: true, passwordStorage: "plaintext", lotsPath: "/api/lots", timeoutMs: 5000, maxRetries: 3, pageSize: 2, pageParam: null, pageSizeParam: null };
  const calls: string[] = [];
  const waits: number[] = [];
  const mk = (cfg: LiveFantasyConfig, handler: (url: string, init: RequestInit) => Response | Promise<Response>) =>
    createFantasyClient({ config: () => cfg, fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => { calls.push(`${init?.method ?? "GET"} ${String(url).replace(cfg.baseUrl, "")}`); return handler(String(url), init ?? {}); }) as typeof fetch, tokenStore: memoryTokenStore(), sleep: async (ms) => { waits.push(ms); }, random: () => 0, readPassword: () => "pw" });
  const tokenRes = () => new Response(JSON.stringify({ access_token: "T1", token_type: "bearer", expires_in: 86400, userName: "U" }), { status: 200, headers: { "content-type": "application/json" } });
  const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });

  let c = mk(base, (url, init) => (url.endsWith("/token") ? tokenRes() : json([{ "Lot ID": "L1" }])));
  await c.fetchLots(); await c.fetchLots();
  assert(calls.filter((x) => x.includes("/token")).length === 1 && calls.filter((x) => x.includes("/api/lots")).length === 2, "token cached: one login for two listings");
  const initBody = (init: RequestInit) => String(init.body ?? "");
  calls.length = 0;
  let sawPasswordInBody = false;
  c = mk(base, (url, init) => { if (url.endsWith("/token")) { sawPasswordInBody = /password=pw/.test(initBody(init)); return tokenRes(); } return json([]); });
  await c.getAccessToken({ forceLogin: true });
  assert(sawPasswordInBody, "password grant is form-encoded to /token (and nowhere else)");

  calls.length = 0; waits.length = 0;
  let n = 0;
  c = mk(base, (url) => (url.endsWith("/token") ? tokenRes() : ++n === 1 ? new Response("boom", { status: 500 }) : json([{ "Lot ID": "L1" }])));
  const r1 = await c.fetchLots();
  assert(r1.rows.length === 1 && waits.length === 1 && waits[0] === 500, "transient 500 retried once after 500ms backoff");
  waits.length = 0;
  c = mk(base, (url) => (url.endsWith("/token") ? tokenRes() : new Response("down", { status: 503 })));
  let err: unknown = null; try { await c.fetchLots(); } catch (e) { err = e; }
  assert(err instanceof FantasyApiError && err.code === "UPSTREAM_ERROR" && err.status === 503 && waits.length === 3 && waits.join(",") === "500,1000,2000", "5xx retried maxRetries times with exponential backoff, then UPSTREAM_ERROR");
  waits.length = 0; n = 0;
  c = mk(base, (url) => (url.endsWith("/token") ? tokenRes() : ++n === 1 ? new Response("slow", { status: 429, headers: { "retry-after": "7" } }) : json([])));
  await c.fetchLots();
  assert(waits.length === 1 && waits[0] === 7000, "429 waits Retry-After seconds");
  calls.length = 0; waits.length = 0;
  c = mk(base, (url) => (url.endsWith("/token") ? tokenRes() : new Response("denied", { status: 401 })));
  err = null; try { await c.fetchLots(); } catch (e) { err = e; }
  assert(err instanceof FantasyApiError && err.code === "AUTH_FAILED" && err.message === "Fantasy authentication failed." && waits.length === 0 && calls.filter((x) => x.includes("/token")).length === 2 && calls.filter((x) => x.includes("/api/lots")).length === 2, "401 → exactly one re-login, then AUTH_FAILED with a safe message and no backoff retries");
  calls.length = 0;
  c = mk(base, () => json({ error: "invalid_grant", error_description: "The user name or password is incorrect." }, 400));
  err = null; try { await c.getAccessToken(); } catch (e) { err = e; }
  assert(err instanceof FantasyApiError && err.code === "AUTH_FAILED" && calls.length === 1, "rejected login → AUTH_FAILED after a single attempt");
  c = mk(base, (url) => { if (url.endsWith("/token")) return tokenRes(); const e = new Error("t"); e.name = "TimeoutError"; throw e; });
  err = null; try { await c.fetchLots(); } catch (e) { err = e; }
  assert(err instanceof FantasyApiError && err.code === "TIMEOUT", "aborted requests surface as TIMEOUT");
  calls.length = 0;
  const paged: LiveFantasyConfig = { ...base, pageParam: "page", pageSizeParam: "pageSize" };
  c = mk(paged, (url) => { if (url.endsWith("/token")) return tokenRes(); const p = Number(new URL(url).searchParams.get("page")); return json(p === 1 ? [{ "Lot ID": "1" }, { "Lot ID": "2" }] : p === 2 ? [{ "Lot ID": "3" }, { "Lot ID": "4" }] : [{ "Lot ID": "5" }]); });
  const pr = await c.fetchLots();
  assert(pr.rows.length === 5 && pr.pages === 3 && calls.filter((x) => x.includes("pageSize=2")).length === 3, "every page fetched until a short page (5 rows over 3 pages)");
  c = mk(base, (url) => (url.endsWith("/token") ? tokenRes() : json({ Data: [{ "Lot ID": "9" }], Total: 1 })));
  assert((await c.fetchLots()).rows[0]["Lot ID"] === "9", "wrapped {Data:[…]} payload unwrapped");
  c = mk(base, (url) => (url.endsWith("/token") ? tokenRes() : json({ message: "nothing" })));
  err = null; try { await c.fetchLots(); } catch (e) { err = e; }
  assert(err instanceof FantasyApiError && err.code === "BAD_RESPONSE", "payload without a row array → BAD_RESPONSE");
  assert(retryDelayMs(0, null, () => 0.5) === 625 && retryDelayMs(3, null, () => 0) === 4000 && retryDelayMs(0, "3", () => 0) === 3000, "backoff formula: 500·2^n + jitter, Retry-After wins");
  c = mk(base, (url) => (url.endsWith("/token") ? tokenRes() : json([{ "Lot ID": "1", Weight: 1 }])));
  const tc = await c.testConnection();
  const tcText = JSON.stringify(tc);
  assert(tc.ok && tc.login.ok && tc.lots.rows === 1 && !/"pw"|"T1"|"username":|"password":/.test(tcText), "connection test reports success without password, token or username");

  console.log("\n--- 7. Live Data mapping (46 fields) ---");
  assert(LIVE_LOT_FIELDS.length === 46 && new Set(LIVE_LOT_FIELDS.map((f) => f.field)).size === 46 && new Set(LIVE_LOT_FIELDS.map((f) => f.header)).size === 46, "46 unique headers and fields");
  assert(LIVE_LOT_FIELDS[0].header === "Metal ID" && LIVE_LOT_FIELDS[6].header === "Lot ID" && LIVE_LOT_FIELDS[45].header === "ItemName", "header order preserved (Metal ID first, ItemName last)");
  const row = { "Metal ID": "M-1", "Metal Wgt": "12.345678", "Previous Department Account": "Sorting", "Process Name": "Polishing", Remark: "", Qty: 1, "Lot ID": "L-1", "Lot Name": "2501-001 HA", "On Hold": "N", "Lot Status DB": "Stock", Shape: "ROUND", Color: "F", Clarity: "VS1", Size: "1.00-1.09", Weight: "1,050.123456", "Lab Name": "GIA", "Certificate No": "GIA-1", Cut: "EX", Polish: "EX", Sym: "VG", "Fluo.": "NON", M1: "6.45", M2: "6.48", M3: "3.99", Table: "57.5", Depth: "61.2", Ratio: "1.00", Tone: "", "Department Account Name": "Surat Vault", "Est. Clarity ID": "VS1", "Est. Color ID": "F", "Avg Weight": "1.05", "Allocation Date": "22/09/2026 10:15", "Allocation Account ID": "CUST-7", "Certificate ID": "C-9", "Company ID": "FDH", "Doc ID": "D-77", "Est. Shape ID": "RD", "Est. Weight": "1.1", "Fancy Color": "", "Metal Color": "Yellow", "Met.Wgt": "0.5", "Original Weight": "2.1", "Tot.Dia.Wgt": "1.05", "Doc Date": "15-08-2026", ItemName: "Polished Diamond", ExtraVendorColumn: "x" };
  const m = mapLiveLot(row);
  assert(!("invalid" in m), "a full row maps");
  if ("invalid" in m) return;
  assert(m.fields.metalId === "M-1" && m.fields.lotId === "L-1" && m.fields.lotStatusDb === "Stock" && m.fields.itemName === "Polished Diamond" && m.fields.symmetry === "VG" && m.fields.fluorescence === "NON", "strings mapped from header-style keys (incl. Sym→Symm, Fluo.)");
  assert(m.fields.weight === "1050.123456" && m.fields.metalWeight === "12.345678" && m.fields.qty === "1" && m.fields.tablePercent === "57.5", "decimals kept as exact strings, thousands separators removed");
  assert(m.fields.onHold === false, "On Hold 'N' → false");
  assert((m.fields.docDate as Date).toISOString() === "2026-08-15T00:00:00.000Z" && (m.fields.allocationDate as Date).toISOString() === "2026-09-22T10:15:00.000Z", "Doc Date dd-MM-yyyy and Allocation Date dd/MM/yyyy HH:mm parsed");
  assert(m.fields.remark === null && m.fields.tone === null && m.fields.fancyColor === null, "empty strings become null (not 0, not '')");
  assert(m.warnings.length === 0, "no warnings when every column is present");
  assert(m.sourceRecordKey === "v1|FDH|D-77|L-1|M-1", "stable composite key company|doc|lot|metal (documented, version-prefixed)");
  assert(m.sourcePayload.ExtraVendorColumn === "x", "raw payload retained verbatim");
  const m2 = mapLiveLot({ ...row, Weight: "1.20" });
  assert(!("invalid" in m2) && m2.sourceRecordKey === m.sourceRecordKey && m2.contentHash !== m.contentHash, "a changed weight keeps the identity and changes the content hash");
  const m3 = mapLiveLot({ ...row });
  assert(!("invalid" in m3) && m3.contentHash === m.contentHash, "identical rows hash identically");
  const partial = mapLiveLot({ lotId: "L-2", weight: "abc", onHold: "maybe", docDate: "??" });
  assert(!("invalid" in partial) && partial.fields.weight === null && partial.fields.onHold === null && partial.fields.docDate === null && partial.warnings.some((w) => /Weight: non-numeric/.test(w)) && partial.warnings.some((w) => /On Hold/.test(w)) && partial.warnings.some((w) => /Doc Date/.test(w)) && partial.warnings.some((w) => /Metal ID: source column absent/.test(w)), "bad values → null + warning; absent columns → null + warning; nothing fabricated");
  assert(!("invalid" in partial) && partial.sourceRecordKey === "v1|||L-2|", "Lot ID alone gives an identity");
  const none = mapLiveLot({ Shape: "ROUND", Weight: "1" });
  assert("invalid" in none && /no stable identity/.test(none.invalid), "a row without Lot ID and Doc ID is rejected");
  assert(stableRecordKey({ companyId: null, docId: "D", lotId: null, metalId: null }) === "v1||D||", "Doc ID alone gives an identity");
  assert(toDecimalString("1e5").ok === false && toDecimalString(1.5).value === "1.5" && toDecimalString("").value === null, "decimal parsing rejects exponent notation and accepts numbers");
  assert(toBoolean("Yes").value === true && toBoolean(0).value === false && toBoolean("x").ok === false, "boolean parsing");
  const out = mapLiveLotRows([row, { ...row, Weight: "1.20" }, "junk", { Shape: "PEAR" }]);
  assert(out.mapped.length === 1 && out.mapped[0].fields.weight === "1.20" && out.mapped[0].warnings.some((w) => /duplicate identity/.test(w)) && out.invalid.length === 2, "duplicate identity keeps the later row; junk and identity-less rows reported invalid");
  assert(out.unmappedSourceColumns.join(",") === "ExtraVendorColumn", "vendor columns outside the contract are reported");
  assert(mappingMatrix().length === 46 && mappingMatrix()[6].field === "lotId", "mapping matrix lists all 46 headers with field/source/type/transform");
  assert(contentHashOf(m.fields).length === 64, "content hash is sha-256 hex");
  console.log(`\n🎉 PART 2 PASSED (${passed} total)`);
}

import * as XLSX from "xlsx";
import { parseLiveExport } from "../src/lib/fantasy/live-import";
import { friendlyErrorSummary } from "../src/lib/fantasy/live-sync";

async function part3() {
  console.log("\n--- 8. Export parsing ---");
  const headers = LIVE_LOT_FIELDS.map((f) => f.header);
  const r1 = headers.map((h) => (h === "Lot ID" ? "L-1" : h === "Weight" ? 1.05 : h === "Doc Date" ? "15-08-2026" : h === "On Hold" ? "N" : h === "Qty" ? 1 : h === "Company ID" ? "FDH" : h === "Doc ID" ? "D-1" : `${h} value`));
  const r2 = headers.map((h) => (h === "Lot ID" ? "L-2" : h === "Weight" ? "2,000.5" : h === "Doc Date" ? "" : h === "On Hold" ? "Y" : ""));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, r1, r2, headers.map(() => "")]), "Lots");
  const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const px = parseLiveExport(xlsxBuf, "fantasy-lots.xlsx");
  assert(px.ok, "xlsx export parses");
  if (!px.ok) return;
  assert(px.format === "xlsx" && px.sheetName === "Lots" && px.headers.length === 46 && px.rows.length === 2, "first sheet, 46 headers, blank trailing row dropped");
  const mx = mapLiveLotRows(px.rows);
  assert(mx.mapped.length === 2 && mx.invalid.length === 0 && mx.unmappedSourceColumns.length === 0, "all 46 export headers map with nothing unmapped");
  assert(mx.mapped[0].fields.lotId === "L-1" && mx.mapped[0].fields.weight === "1.05" && mx.mapped[0].fields.onHold === false && (mx.mapped[0].fields.docDate as Date).toISOString() === "2026-08-15T00:00:00.000Z", "typed values survive xlsx round trip");
  assert(mx.mapped[1].fields.weight === "2000.5" && mx.mapped[1].fields.docDate === null && mx.mapped[1].fields.onHold === true && mx.mapped[1].fields.shape === null, "second row: comma decimal, empty date → null, empty strings → null");
  const csv = [headers.join(","), r1.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","), ""].join("\n");
  const pc = parseLiveExport(new TextEncoder().encode("﻿" + csv).buffer as ArrayBuffer, "export.csv");
  assert(pc.ok && pc.format === "csv" && pc.rows.length === 1 && pc.headers[0] === "Metal ID", "csv export (with BOM) parses to the same headers");
  const mc = pc.ok ? mapLiveLotRows(pc.rows) : null;
  assert(!!mc && mc.mapped.length === 1 && mc.mapped[0].sourceRecordKey === mx.mapped[0].sourceRecordKey, "csv and xlsx rows of the same lot share one identity");
  const bad = parseLiveExport(new TextEncoder().encode("not a workbook").buffer as ArrayBuffer, "x.xlsx");
  assert(!bad.ok && bad.status === 400, "non-zip .xlsx rejected with 400");
  const wrong = parseLiveExport(new ArrayBuffer(10), "x.pdf");
  assert(!wrong.ok && /xlsx or .csv/.test(wrong.message), "unsupported extension rejected");
  const empty = parseLiveExport(new TextEncoder().encode("\n\n").buffer as ArrayBuffer, "e.csv");
  assert(!empty.ok, "empty csv rejected");

  console.log("\n--- 9. Friendly failure summaries ---");
  assert(/internal error \(HTTP 500\)/.test(friendlyErrorSummary("UPSTREAM_ERROR", new FantasyApiError("x", "UPSTREAM_ERROR", 500))) && friendlyErrorSummary("AUTH_FAILED", null) === "Fantasy authentication failed.", "vendor 500 and auth failures get user-facing sentences");
  console.log(`\n🎉 PART 3 PASSED (${passed} total)`);
}
