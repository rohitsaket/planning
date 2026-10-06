// Encrypted-at-rest secrets for .env values.
//
// A secret may be stored in plain text or as an `enc:v1:<base64>` envelope produced by
// `npm run secret:encrypt`. Envelopes are AES-256-GCM, keyed by SECRETS_KEY (32 random bytes,
// base64). The plaintext never leaves the server process, is never logged, and is never
// returned by any API route. Rotate by generating a new SECRETS_KEY and re-encrypting.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const SECRET_ENVELOPE_PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function isEncryptedSecret(value: string | undefined | null): boolean {
  return typeof value === "string" && value.startsWith(SECRET_ENVELOPE_PREFIX);
}

export function generateSecretsKey(): string {
  return randomBytes(32).toString("base64");
}

function loadKey(explicit?: string): Buffer {
  const raw = explicit ?? process.env.SECRETS_KEY;
  if (!raw) throw new Error("SECRETS_KEY is not set: cannot encrypt or decrypt secrets.");
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32).");
  return key;
}

export function encryptSecret(plaintext: string, key?: string): string {
  const k = loadKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return SECRET_ENVELOPE_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(value: string, key?: string): string {
  if (!isEncryptedSecret(value)) return value;
  const k = loadKey(key);
  const blob = Buffer.from(value.slice(SECRET_ENVELOPE_PREFIX.length), "base64");
  if (blob.length < IV_BYTES + TAG_BYTES + 1) throw new Error("Encrypted secret envelope is malformed.");
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Encrypted secret could not be decrypted: wrong SECRETS_KEY or corrupted value.");
  }
}

/** Reads an environment variable that may be stored encrypted. Returns null when unset/empty. */
export function readSecretEnv(name: string): string | null {
  const v = process.env[name];
  if (!v || v.trim() === "") return null;
  return decryptSecret(v.trim());
}

/** For status displays: says whether a secret is configured and how, never what it is. */
export function describeSecretEnv(name: string): "missing" | "plaintext" | "encrypted" {
  const v = process.env[name];
  if (!v || v.trim() === "") return "missing";
  return isEncryptedSecret(v.trim()) ? "encrypted" : "plaintext";
}
