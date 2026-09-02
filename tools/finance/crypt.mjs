/**
 * Envelope encryption for the dashboard payload.
 *
 * The ciphertext lives in a public repo, so the passphrase is the only thing
 * standing between a passer-by and the whole ledger. That shapes the choices:
 * PBKDF2-SHA256 at a deliberately painful iteration count (the browser eats
 * ~1–2s once, on purpose), then AES-256-GCM which authenticates as well as
 * encrypts — a tampered blob fails to decrypt rather than decoding to garbage.
 *
 * Parameters are written into the envelope so the client never hard-codes
 * them and they can be raised later without breaking old blobs.
 */

import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const randomBytes = (n) => webcrypto.getRandomValues(new Uint8Array(n));

// ~1s on a modern laptop, a few seconds on a phone: paid once per unlock.
// OWASP's floor for PBKDF2-SHA256 is 600k, but that floor assumes a *private*
// hash. This ciphertext is public and PBKDF2 runs happily on a GPU, so the
// iteration count buys maybe twenty bits and the passphrase has to supply the
// rest. Hence the entropy check in build-finance.mjs.
export const KDF_ITERATIONS = 10_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const b64 = (buf) => Buffer.from(buf).toString('base64');

async function deriveKey(passphrase, salt, iterations) {
  const material = await subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPayload(bytes, passphrase) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);

  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS,
    cipher: 'AES-256-GCM',
    compression: 'gzip',
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(ct),
  };
}
