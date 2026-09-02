#!/usr/bin/env node
/**
 * Test a passphrase against the published payload, locally and instantly.
 *
 *   npm run finance:check          # prompts, hidden input
 *
 * Exists because "it doesn't work in the browser" is a bad debugging loop: a
 * second of PBKDF2 and a page reload per guess, with no way to tell a wrong
 * passphrase from a corrupt file. This answers both, and it also tries the
 * usual ways a shell quietly mangles a passphrase on its way into the build —
 * a trailing newline, a stray space, curly quotes pasted from a notes app.
 *
 * Nothing is printed but the verdict. The passphrase is never echoed, never
 * logged, and never written anywhere.
 */

import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { webcrypto } from 'node:crypto';
import { createInterface } from 'node:readline';
import path from 'node:path';

const { subtle } = webcrypto;
const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'public', 'finances', 'data.enc.json');

if (!existsSync(FILE)) {
  console.error(`\n  No payload at ${FILE}\n  Run \`npm run finance\` first.\n`);
  process.exit(1);
}
const env = JSON.parse(readFileSync(FILE, 'utf8'));
const b64 = (s) => Buffer.from(s, 'base64');

async function tryPassphrase(passphrase) {
  const key = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: b64(env.salt),
      iterations: env.iterations,
      hash: 'SHA-256',
    },
    await subtle.importKey(
      'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
    ),
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  try {
    const plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: b64(env.iv) }, key, b64(env.ct),
    );
    const json = env.compression === 'gzip'
      ? gunzipSync(Buffer.from(plain)).toString('utf8')
      : Buffer.from(plain).toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** The ways a passphrase gets quietly altered between a person and this file. */
function variants(p) {
  const out = new Map();
  const add = (label, value) => {
    if (value && value !== p && !out.has(value)) out.set(value, label);
  };
  add('with a trailing space', `${p} `);
  add('with a leading space', ` ${p}`);
  add('trimmed of surrounding whitespace', p.trim());
  add('with a trailing newline', `${p}\n`);
  add('with a trailing carriage return', `${p}\r`);
  // Curly quotes and dashes, as pasted from Notes, Word or a browser.
  add('with curly quotes straightened', p
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"'));
  add('with an en/em dash turned into a hyphen', p.replace(/[–—]/g, '-'));
  add('with a non-breaking space turned into a normal one', p.replace(/ /g, ' '));
  add('lower-cased', p.toLowerCase());
  add('with the first letter capitalised', p.charAt(0).toUpperCase() + p.slice(1));
  // zsh eats an unquoted `!` and expands `$word` inside double quotes.
  add('without exclamation marks', p.replace(/!/g, ''));
  return out;
}

const passphrase = process.env.FINANCE_PASSPHRASE ?? await ask();

process.stdout.write('\n  Checking');
const tick = setInterval(() => process.stdout.write('.'), 400);

let result = await tryPassphrase(passphrase);
let note = null;

if (!result) {
  for (const [candidate, label] of variants(passphrase)) {
    result = await tryPassphrase(candidate);
    if (result) { note = label; break; }
  }
}
clearInterval(tick);

if (result) {
  const m = result.meta;
  console.log('\n\n  ✓ This passphrase decrypts the file.\n');
  if (note) {
    console.log(`  But only ${note}.`);
    console.log('  Something between your keyboard and the build script changed it —');
    console.log('  most likely the shell, or a paste from an app that autocorrects.');
    console.log('  Re-run `npm run finance` and type it at the prompt to reset it.\n');
  }
  console.log(`  Payload:    ${m.txCount.toLocaleString()} transactions, ${m.firstDate} → ${m.lastDate}`);
  console.log(`  As of:      ${m.asOf}`);
  console.log(`  Built:      ${new Date(m.generated).toLocaleString()}`);
  console.log(`  Net worth:  $${result.headline.netWorth.toLocaleString()}\n`);
} else {
  console.log('\n\n  ✗ This passphrase does not decrypt the file.\n');
  console.log('  The file itself is fine — AES-GCM authenticates, so a corrupt or truncated');
  console.log('  blob fails differently and the envelope here is well formed. It is the');
  console.log('  passphrase that does not match.');
  console.log('\n  The usual cause is the shell, not your memory. In zsh:');
  console.log('    • an unquoted or double-quoted `!` triggers history expansion');
  console.log('    • `$word` expands inside double quotes, often to nothing');
  console.log('    • a passphrase pasted from Notes may carry curly quotes or an em dash');
  console.log('\n  Simplest fix: `npm run finance`, type the passphrase at the prompt when');
  console.log('  asked, and let it re-encrypt. That path takes the characters literally.\n');
  process.exitCode = 1;
}

function ask() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((res) => {
    // Suppress the echo so the passphrase never reaches the scrollback.
    const onData = (char) => {
      if (['\n', '\r', ''].includes(String(char))) process.stdin.pause();
      else process.stdout.write('[2K[200D  Passphrase: ');
    };
    process.stdin.on('data', onData);
    rl.question('  Passphrase: ', (a) => {
      process.stdin.removeListener('data', onData);
      rl.close();
      res(a);
    });
  });
}
