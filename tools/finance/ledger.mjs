/**
 * The canonical ledger: one append-only JSONL file that every export merges
 * into, and the only thing the dashboard is built from.
 *
 * Why a store rather than re-reading the CSVs each time. Exports overlap, get
 * re-downloaded, and disagree with each other. Reading them fresh every build
 * means the same transaction can appear, vanish or change identity depending on
 * which files happen to be in the folder. Here, a transaction gets a stable id
 * the first time it is seen and keeps it forever: re-importing the same export
 * is a no-op, a longer export adds only what is new, and a correction attached
 * to an id survives every future import.
 *
 * The id is a hash of (date, account, normalised payee, amount, sequence).
 * Sequence is what makes genuine repeats work — two identical $4 coffees on the
 * same day are two rows, #0 and #1, and they stay #0 and #1 on every re-import.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';

export const LEDGER_VERSION = 1;

/**
 * Payee text, reduced to the part that identifies the transaction. Banks send
 * the same payment through two feeds with different decoration — a cleaned
 * "AGUA FRIA UNION PAYROLL PPD ID: 1866004326" and a raw
 * "ORIG CO NAME:AGUA FRIA UNION CO ENTRY DESCR:PAYROLL" — and these have to
 * collapse to the same key or the transaction is counted twice.
 */
export function identityKey(payee) {
  let k = (payee ?? '').toLowerCase();
  // Bank boilerplate arrives glued to the payee as often as separated from it —
  // "AGUA FRIA UNION  PAYROLLPPD ID: 1866004326" and
  // "ORIG CO NAME:AGUA FRIA UNION  COENTRY DESCR:PAYROLL" describe one deposit,
  // and neither has a space where a word boundary would be convenient. So these
  // patterns deliberately do not require one.
  k = k.replace(/orig\s*co\s*name\s*:/g, ' ');
  k = k.replace(/co\s*entry\s*descr\s*:.*$/g, ' ');
  k = k.replace(/(ppd|web|ccd|arc|tel)\s*id\s*:.*$/g, ' ');
  k = k.replace(/orig\s*id\s*:?\s*\S*/g, ' ');
  k = k.replace(/\bsec\s*:\s*\S*/g, ' ');
  k = k.replace(/transaction\s*#\s*:?\s*\S*/g, ' ');
  k = k.replace(/\b\d{4,}\b/g, ' ');
  k = k.replace(/[^a-z ]/g, ' ');
  k = k.replace(/\s+/g, ' ').trim();

  // Mint truncates `Original Description` at 32 characters, which routinely
  // severs "CO ENTRY DESCR:" mid-phrase and leaves a dangling "co" behind:
  // "ORIG CO NAME:AGUA FRIA UNION  CO". That orphan is enough to stop
  // "agua fria union co" prefix-matching "agua fria union payroll", so trailing
  // fragments of known boilerplate are dropped.
  const ORPHANS = new Set(['co', 'entry', 'descr', 'sec', 'ppd', 'ccd', 'web',
    'arc', 'tel', 'id', 'orig', 'name', 'des', 'ind']);
  const tokens = k.split(' ').filter(Boolean);
  while (tokens.length > 2 && ORPHANS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.slice(0, 4).join(' ');
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * The id is built from the *canonical* key of a merged group — the shortest of
 * the descriptions that were folded together — rather than from whichever row
 * happened to be read first. Two feeds wording one payment differently must
 * land on the same id no matter which order the exports arrive in, or the
 * ledger grows a new row every time the CSVs are re-read.
 */
export function transactionId(tx, seq) {
  return hash([
    tx.date, tx.account, tx.canonicalKey ?? identityKey(tx.rawPayee ?? tx.payee),
    Math.round(tx.amount * 100), seq,
  ].join('|'));
}

/**
 * Do two descriptions name the same thing?
 *
 * Exact key equality is too strict: Mint stores one paycheque as
 * "AGUA FRIA UNION PAYROLL PPD ID: …" and the same one as
 * "ORIG CO NAME:AGUA FRIA UNION CO ENTRY DESCR:PAYROLL", which reduce to
 * "agua fria union payroll" and "agua fria union". One is a token-prefix of the
 * other, because the raw feed simply carries fewer words once its boilerplate
 * is stripped.
 *
 * Prefix matching has to be kept on a short leash, though. A one-token key like
 * "payment" or "transfer" prefixes half the ledger, so the shorter side needs at
 * least two tokens, must not be a generic banking phrase, and must be within two
 * tokens of the longer one.
 */
const GENERIC = new Set([
  'online transfer', 'internet transfer', 'payment thank', 'transfer to',
  'transfer from', 'atm withdrawal', 'atm deposit', 'online payment',
  'check deposit', 'remote deposit', 'external transfer', 'mobile deposit',
]);

export function sameMerchant(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = a.split(' ');
  const tb = b.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2) return false;
  if (long.length - short.length > 2) return false;
  if (GENERIC.has(short.join(' '))) return false;
  return short.every((tok, i) => long[i] === tok);
}

/**
 * Is a same-day, same-account, same-amount pair the same transaction imported
 * twice, or two real movements?
 *
 * Only one signal is trustworthy: the two rows word themselves differently
 * while naming the same merchant. That is the two-feed signature — nobody buys
 * the same coffee twice and has the bank phrase it two ways — and it is what
 * inflated 2022 income by $44,470 on Agua Fria payroll alone.
 *
 * Byte-identical rows are deliberately NOT treated as duplicates, even for
 * large non-retail amounts where a same-day repeat looks implausible. That rule
 * was tried and it was wrong: on 2018-03-22 there are four identical $10,000
 * "Online Transfer Barclays" rows on one account, which is not a double import
 * but $40,000 moved in four chunks against a $10,000 per-transfer cap.
 *
 * And even the two-feed signature only runs against sources known to double
 * import. Simplifi does not: on 2026-09-01 it carries two $80,000 debits from
 * Chase worded differently — "BARCLAYS BANK DE COLLECTION WEB ID" and
 * "BARCLAYS BANK DE CO ENTRY DESCR:COLLECTION" — which look exactly like one
 * payment seen twice. They are not. One landed at Barclays and one at
 * Wealthfront, both confirmed against the banks, and the Chase balance
 * reconciles to the cent only with both present. Collapsing them put checking
 * $80,000 out.
 *
 * The rule, then: when the evidence is only "this looks unlikely", the
 * duplicate stays.
 */
/**
 * Exporters known to record one transaction more than once. Mint does; Simplifi
 * does not, and treating it as if it did deletes real money.
 */
export const DOUBLE_IMPORTING_SOURCES = new Set(['mint']);

export function isDuplicate(a, b) {
  if (!DOUBLE_IMPORTING_SOURCES.has(a.source ?? b.source)) return false;
  if (a.date !== b.date) return false;
  if (a.account !== b.account) return false;
  if (Math.round(a.amount * 100) !== Math.round(b.amount * 100)) return false;
  if ((a.rawPayee ?? '').trim() === (b.rawPayee ?? '').trim()) return false;
  return sameMerchant(
    identityKey(a.rawPayee ?? a.payee),
    identityKey(b.rawPayee ?? b.payee),
  );
}

/**
 * Collapse duplicates within one batch and assign sequence numbers to the
 * genuine repeats that survive.
 */
export function dedupe(transactions) {
  // Group on the hard facts only — account, day, exact amount. Description is
  // the unreliable part, so it decides duplication *within* a group rather than
  // deciding who is in one.
  const groups = new Map();
  for (const t of transactions) {
    const k = `${t.date}|${t.account}|${Math.round(t.amount * 100)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }

  const kept = [];
  const dropped = [];
  for (const rows of groups.values()) {
    const survivors = [];
    for (const t of rows) {
      const dupOf = survivors.find((s) => isDuplicate(s, t));
      if (!dupOf) {
        t.mergedKeys = [identityKey(t.rawPayee ?? t.payee)];
        survivors.push(t);
        continue;
      }
      dropped.push({ ...t, duplicateOf: dupOf.id ?? dupOf.rawPayee });
      dupOf.mergedKeys.push(identityKey(t.rawPayee ?? t.payee));
      // Keep the more *informative* description, not the longer one. The
      // "ORIG CO NAME:AGUA FRIA UNION  CO" form is longer in characters but
      // says less: it is boilerplate truncated mid-phrase, and the word
      // "PAYROLL" — which is how a paycheque is recognised downstream — lives
      // only in the other one. Preferring raw length here silently cut detected
      // payroll almost in half.
      const keep = identityKey(t.rawPayee ?? t.payee).split(' ').length;
      const have = identityKey(dupOf.rawPayee ?? dupOf.payee).split(' ').length;
      if (keep > have
        || (keep === have && (t.rawPayee ?? '').length > (dupOf.rawPayee ?? '').length)) {
        dupOf.rawPayee = t.rawPayee;
        dupOf.payee = t.payee;
      }
    }

    // Deterministic order so sequence numbers do not depend on which export
    // was read first.
    for (const t of survivors) {
      t.canonicalKey = [...t.mergedKeys].sort((x, y) => x.length - y.length || (x < y ? -1 : 1))[0];
      delete t.mergedKeys;
    }
    survivors.sort((a, b) => (a.canonicalKey < b.canonicalKey ? -1
      : a.canonicalKey > b.canonicalKey ? 1 : 0));
    survivors.forEach((t, i) => {
      t.seq = i;
      t.id = transactionId(t, i);
      kept.push(t);
    });
  }

  kept.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { kept, dropped };
}

// ── Store ───────────────────────────────────────────────────────────────────

export function loadLedger(path) {
  if (!existsSync(path)) return new Map();
  const out = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const t = JSON.parse(line);
    out.set(t.id, t);
  }
  return out;
}

/** Written atomically — a half-written ledger is worse than a stale one. */
export function saveLedger(path, store) {
  const rows = [...store.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  renameSync(tmp, path);
  return rows.length;
}

/**
 * Merge a freshly imported batch into the store.
 *
 * Existing rows are never overwritten: whatever is already recorded for an id
 * wins, so a correction made once is not undone by the next import. Only the
 * bookkeeping fields (which export last mentioned it, and when) are refreshed.
 */
export function mergeIntoLedger(store, batch, source, importedAt) {
  const stats = { added: 0, alreadyKnown: 0, conflicting: [] };

  for (const t of batch) {
    const existing = store.get(t.id);
    if (!existing) {
      store.set(t.id, {
        ...t, source, firstSeen: importedAt, lastSeen: importedAt,
      });
      stats.added++;
      continue;
    }
    stats.alreadyKnown++;
    existing.lastSeen = importedAt;
    if (!existing.sources) existing.sources = [existing.source];
    if (!existing.sources.includes(source)) existing.sources.push(source);

    // Same id, different content means the exports disagree about a
    // transaction they both claim. Worth reporting rather than silently
    // preferring one.
    if (existing.category !== t.category && !existing.categoryOverride) {
      stats.conflicting.push({
        id: t.id, date: t.date, payee: t.payee,
        was: existing.category, now: t.category, source,
      });
    }
  }
  return stats;
}

/** User corrections, keyed by transaction id, applied after every import. */
export function applyOverrides(store, overrides) {
  let applied = 0;
  for (const [id, patch] of Object.entries(overrides ?? {})) {
    const t = store.get(id);
    if (!t) continue;
    Object.assign(t, patch, { categoryOverride: patch.category !== undefined });
    applied++;
  }
  return applied;
}
