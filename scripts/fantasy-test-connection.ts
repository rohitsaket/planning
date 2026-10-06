// Tests the live Fantasy API connection from the command line using the .env configuration.
// Prints host, user, token expiry and the listing result — never a credential or a token.
// Usage: npm run fantasy:test-connection
import { testFantasyConnection, getLiveFantasyConfig } from "../src/lib/fantasy/live-api";

async function main() {
  const cfg = getLiveFantasyConfig();
  console.log(`Fantasy API: host=${cfg.baseUrl ? new URL(cfg.baseUrl).host : "not set"} usernameConfigured=${cfg.usernameConfigured} passwordConfigured=${cfg.passwordConfigured} (${cfg.passwordStorage}) lotsPath=${cfg.lotsPath} configured=${cfg.configured}${cfg.missing.length ? " missing=" + cfg.missing.join(",") : ""}`);
  const r = await testFantasyConnection();
  console.log(`login: ${r.login.ok ? "OK" : "FAILED"}${r.login.issuedTo ? ` as ${r.login.issuedTo}` : ""}${r.login.expiresAt ? ` (token valid until ${r.login.expiresAt}${r.login.fromCache ? ", from cache" : ", fresh login"})` : ""}${r.login.error ? ` :: ${r.login.error}` : ""}`);
  console.log(`lots:  ${r.lots.ok ? "OK" : "FAILED"} ${r.lots.path} status=${r.lots.status ?? "n/a"}${r.lots.rows !== null ? ` rows=${r.lots.rows}` : ""}${r.lots.sampleColumns.length ? ` columns=${r.lots.sampleColumns.join(", ")}` : ""}${r.lots.error ? ` :: ${r.lots.error}` : ""}`);
  console.log(`${r.ok ? "PASS" : "FAIL"} in ${r.durationMs}ms`);
  process.exit(r.ok ? 0 : 1);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
