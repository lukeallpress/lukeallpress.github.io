/**
 * Client half of the passphrase gate.
 *
 * The encrypted blob sits in a public repo, so this deliberately does the
 * expensive thing: PBKDF2-SHA256 at whatever iteration count the envelope
 * declares (currently 700k, roughly a second of work). That cost is paid once
 * per unlock by the person who knows the passphrase, and per *guess* by
 * anyone who doesn't.
 *
 * AES-GCM authenticates as well as encrypts, so a wrong passphrase throws
 * rather than yielding plausible-looking garbage — which is what lets the
 * "wrong passphrase" message be honest.
 */

const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress the payload (needs DecompressionStream).');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function unlock(envelope, passphrase) {
  const salt = b64ToBytes(envelope.salt);
  const iv = b64ToBytes(envelope.iv);
  const ct = b64ToBytes(envelope.ct);

  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: envelope.iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    const err = new Error('WRONG_PASSPHRASE');
    err.code = 'WRONG_PASSPHRASE';
    throw err;
  }

  const json = envelope.compression === 'gzip'
    ? await gunzip(new Uint8Array(plain))
    : new TextDecoder().decode(plain);
  return JSON.parse(json);
}

/**
 * Rehydrate the dictionary-encoded ledger. Stored as parallel integer columns
 * to keep the encrypted blob small; expanded once, here, into plain objects.
 */
export function expandLedger({ dict, rows }, dayZero) {
  const base = Date.parse(`${dayZero}T00:00:00Z`);
  return rows.map(([d, acct, payee, cat, flow, cents, excluded]) => ({
    date: new Date(base + d * 86400000).toISOString().slice(0, 10),
    account: dict.accounts[acct],
    payee: dict.payees[payee],
    category: dict.categories[cat],
    flow: dict.flows[flow],
    amount: cents / 100,
    excluded: !!excluded,
  }));
}
