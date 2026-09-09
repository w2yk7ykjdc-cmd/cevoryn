import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "@/env";

/**
 * Sprint 23 Phase 2: encryption-at-rest for organization-scoped Binance
 * credentials. No new dependency added -- Node's built-in `crypto` module
 * (already used by `execution/binance-private-client.ts` for HMAC signing
 * and `api-keys/service.ts` for key hashing) is sufficient for AES-256-GCM.
 *
 * The encryption key is derived from `BETTER_AUTH_SECRET` (already a
 * required, >=32-character server secret -- see `env.ts`) via `scrypt` with
 * a fixed, purpose-specific salt/info string, rather than requiring a brand
 * new secret to configure. This is a KEY-DERIVATION seam, not key reuse:
 * `BETTER_AUTH_SECRET` itself is never used directly as an AES key, and a
 * future sprint that wants a dedicated secret-manager-issued encryption key
 * can swap the single `deriveKey()` function below without touching any
 * caller.
 *
 * AES-256-GCM (not ECB/CBC) is used specifically for its authentication
 * tag: a tampered ciphertext fails to decrypt rather than silently
 * producing garbage plaintext that might otherwise get treated as a real
 * (wrong) API key/secret.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_DERIVATION_SALT = "companyos:execution-credentials:v1";
const IV_LENGTH_BYTES = 12; // GCM's recommended IV length

let cachedKey: Buffer | null = null;

function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;
  cachedKey = scryptSync(env.BETTER_AUTH_SECRET, KEY_DERIVATION_SALT, 32);
  return cachedKey;
}

/**
 * Returns `iv:authTag:ciphertext`, each base64-encoded and colon-joined --
 * a single self-contained string safe to store in one `String` column.
 * Never includes the plaintext or the key.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export class CredentialDecryptionError extends Error {
  constructor() {
    super("Failed to decrypt stored execution credential -- ciphertext or auth tag invalid");
    this.name = "CredentialDecryptionError";
  }
}

export function decryptSecret(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 3) throw new CredentialDecryptionError();
  const [ivB64, authTagB64, ciphertextB64] = parts;
  try {
    const decipher = createDecipheriv(ALGORITHM, deriveKey(), Buffer.from(ivB64!, "base64"));
    decipher.setAuthTag(Buffer.from(authTagB64!, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64!, "base64")), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new CredentialDecryptionError();
  }
}

/** A short, non-reversible display fingerprint (last 4 chars) -- mirrors `ApiKey.keyPrefix`'s own "enough to recognize, not enough to reconstruct" precedent. Never the means of authentication itself. */
export function fingerprint(value: string): string {
  return value.length <= 4 ? "****" : `****${value.slice(-4)}`;
}
