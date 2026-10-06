// Encrypts a secret for storage in .env as an `enc:v1:` envelope (AES-256-GCM under SECRETS_KEY).
// The plaintext is read from the SECRET_VALUE environment variable or from a file, never from
// the command line, and is never echoed back.
//
// Usage:
//   SECRET_VALUE='…' npx tsx --env-file-if-exists=.env scripts/encrypt-secret.ts
//   npx tsx --env-file-if-exists=.env scripts/encrypt-secret.ts --file /path/to/plaintext.txt
//   npx tsx scripts/encrypt-secret.ts --new-key        # prints a fresh SECRETS_KEY
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
