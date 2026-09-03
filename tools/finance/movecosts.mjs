/**
 * The move, as a one-time budget.
 *
 * This is deliberately separate from everything else. Buying a house, selling
 * one, moving between them and furnishing the result is a burst of spending
 * that says nothing about whether the household can carry the place afterwards
 * — and folding it into a twelve-month average would make the ongoing numbers
 * look far worse than they are. The affordability baseline excludes it; this is
 * where it goes instead.
 *
 * Items are matched against the ledger where a payee can be inferred, so the
 * list separates what has actually been paid from what is still an estimate.
 */

import { readFileSync, existsSync } from 'node:fs';
import { parseCsv } from './parse.mjs';

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

const money = (s) => {
  const v = String(s ?? '').replace(/[$,\s]/g, '');
  const n = Number(v);
  return Number.isFinite(n) && v !== '' ? n : null;
};

/**
 * Buckets, because $108,185.62 of cash to close and a $40 microwave are not
 * usefully the same line item. Order matters — first match wins.
 */
const BUCKETS = [
  {
    key: 'transaction',
    label: 'Buying the house',
    test: /earnest|cash to close|inspection|appraisal/i,
    note: 'The transaction itself. Funded from savings and the Wealthfront sale, '
      + 'not from monthly income.',
  },
  {
    key: 'selling',
    label: 'Getting the old house sold',
    test: /solare|selling/i,
    note: 'Spent to sell 6825, and recovered in the sale price.',
  },
  {
    key: 'moving',
    label: 'The move itself',
    test: /mover|uhaul|u-haul|moving box|lunch for friends|cleaning/i,
    note: 'One week, gone.',
  },
  {
    key: 'fitting',
    label: 'Fitting out the new house',
    test: /closet|cabinet|thermostat|pegboard|weather|sandbag|washing machine|hose|home depot|lowe/i,
    note: 'Fixed to the house. Some of it holds its value at resale.',
  },
  {
    key: 'furnishing',
    label: 'Furniture and outdoor',
    test: /.*/,
    note: 'Movable. The most deferrable part of the list, and the easiest to '
      + 'spread across a year rather than a month.',
  },
];

/**
 * Ledger payees that plausibly correspond to a line on the list.
 *
 * Matching is one-to-one: a ledger transaction can back at most one item, and
 * items are matched in order of how distinctive their pattern is. Without that,
 * three separate Home Depot lines each claimed the same $370.56 and the earnest
 * wire was counted again inside cash to close, which made every variance wrong
 * in the same direction.
 */
const LEDGER_HINTS = [
  { test: /cash to close/i, match: /wells fargo na\/ a\/c: dhi ti/i, specificity: 10 },
  { test: /earnest/i, match: /online domestic wire transfer/i, specificity: 9 },
  { test: /appraisal/i, match: /appraisal/i, specificity: 9 },
  { test: /closet/i, match: /closets by design/i, specificity: 9, staged: true },
  { test: /cabinet/i, match: /pedro/i, specificity: 9, staged: true },
  { test: /^movers$/i, match: /movinghelp/i, specificity: 8 },
  { test: /movers tips/i, match: /gramz moving/i, specificity: 8 },
  { test: /uhaul|u-haul/i, match: /u-haul/i, specificity: 8 },
  { test: /pegboard/i, match: /ace hardware/i, specificity: 7 },
  { test: /lowe/i, match: /lowe's/i, specificity: 5 },
  { test: /home depot/i, match: /home depot/i, specificity: 4 },
];

export function moveCosts(csvPath, config, transactions) {
  if (!existsSync(csvPath)) return null;

  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const header = rows[0].map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[idx.Item] ?? '').trim();
    if (!name) continue;
    const cost = money(r[idx.Cost]);
    const note = (r[idx.Note] ?? '').trim();

    // A row with no parseable cost is a note to self, not a number. Keep it
    // visible rather than dropping it — an unpriced item is still an item.
    const bucket = BUCKETS.find((b) => b.test.test(`${name} ${note}`));

    const hint = LEDGER_HINTS.find((h) => h.test.test(name));

    items.push({
      name,
      cost,
      unpriced: cost === null,
      rawCost: cost === null ? (r[idx.Cost] ?? '').trim() : null,
      note: note || null,
      bucket: bucket.key,
      estimate: /guess|i think|\?/i.test(`${note} ${name}`),
      hint,
      paid: null,
      variance: null,
    });
  }

  // Assign ledger transactions to items, most distinctive pattern first, and
  // never twice.
  const pool = transactions.filter(
    (t) => (t.flow === 'expense' || t.flow === 'transfer')
      && t.date >= config.realEstate[0].contractDate,
  );
  const claimed = new Set();
  for (const item of [...items].sort(
    (a, b) => (b.hint?.specificity ?? 0) - (a.hint?.specificity ?? 0),
  )) {
    if (!item.hint) continue;
    let matched = pool.filter((t) => !claimed.has(t.id)
      && item.hint.match.test(t.rawPayee ?? t.payee));
    if (!matched.length) continue;

    // Both wires to the title company read the same way, so a pattern alone
    // would fold the $10,000 earnest deposit into the $108,185.62 cash to close.
    // Where the listed cost pins it down, take the single closest transaction
    // rather than the sum.
    if (item.cost != null && matched.length > 1) {
      const exact = matched.find(
        (t) => Math.abs(Math.abs(t.amount) - item.cost) <= Math.max(1, item.cost * 0.01),
      );
      if (exact) matched = [exact];
    }
    for (const t of matched) claimed.add(t.id);
    item.paid = {
      total: round(matched.reduce((s2, t) => s2 + Math.abs(t.amount), 0)),
      count: matched.length,
      last: matched[matched.length - 1].date,
    };
    // A job billed in stages is not over budget or under it — part of it simply
    // has not been invoiced yet. The closet and the cabinets are both deposits
    // against a larger total, so the useful number is the balance, not a variance.
    if (item.hint.staged && item.cost != null && item.paid.total < item.cost) {
      item.remaining = round(item.cost - item.paid.total);
      item.staged = true;
      item.variance = null;
    } else {
      item.variance = item.cost != null ? round(item.paid.total - item.cost) : null;
    }
  }
  for (const item of items) delete item.hint;

  const outstanding = items.filter((x) => x.remaining > 0);

  const groups = BUCKETS.map((b) => {
    const mine = items.filter((x) => x.bucket === b.key);
    return {
      ...b,
      test: undefined,
      items: mine.sort((a, x) => (x.cost ?? 0) - (a.cost ?? 0)),
      total: round(mine.reduce((s, x) => s + (x.cost ?? 0), 0)),
      count: mine.length,
    };
  }).filter((g) => g.count);

  const total = round(items.reduce((s, x) => s + (x.cost ?? 0), 0));
  const transaction = groups.find((g) => g.key === 'transaction')?.total ?? 0;
  const estimates = items.filter((x) => x.estimate);

  return {
    source: 'Moving Needs — Costs',
    items,
    groups,
    total,
    transaction,
    // The number that actually answers "what did the move cost us", as distinct
    // from "what did the house cost": the transaction is capital, the rest is spend.
    excludingTransaction: round(total - transaction),
    unpriced: items.filter((x) => x.unpriced),
    estimates,
    estimatedValue: round(estimates.reduce((s, x) => s + (x.cost ?? 0), 0)),
    matched: items.filter((x) => x.paid),
    outstanding,
    outstandingTotal: round(outstanding.reduce((s, x) => s + x.remaining, 0)),
    paidTotal: round(items.reduce((s, x) => s + (x.paid?.total ?? 0), 0)),
    variances: items
      .filter((x) => x.variance != null && Math.abs(x.variance) >= 100)
      .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)),
  };
}
