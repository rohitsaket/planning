import { readFileSync } from "node:fs";
import { encryptSecret, generateSecretsKey } from "../src/lib/security/secrets";

const args = process.argv.slice(2);
if (args.includes("--new-key")) {
  console.log(`SECRETS_KEY=${generateSecretsKey()}`);
  process.exit(0);
}
const fileIdx = args.indexOf("--file");
const plaintext = fileIdx >= 0 ? readFileSync(args[fileIdx + 1], "utf8").replace(/\r?\n$/, "") : process.env.SECRET_VALUE;
if (!plaintext) {
  console.error("Provide the secret via SECRET_VALUE or --file <path>. Nothing was encrypted.");
  process.exit(2);
}
if (!process.env.SECRETS_KEY) {
  console.error("SECRETS_KEY is not set. Generate one with --new-key, add it to .env, then run again.");
  process.exit(2);
}
console.log(encryptSecret(plaintext));
