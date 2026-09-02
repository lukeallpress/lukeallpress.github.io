/**
 * Parse + normalise the Simplifi transaction export.
 *
 * The export is a flat CSV with a quirk worth knowing: Simplifi records
 * transfers by putting the *other account's name* in the Category column.
 * So `Category: "Luke Chase Checking"` on a Sapphire row is a card payment,
 * not a spending category. We use that, plus the Exclusion flag, to sort every
 * row into one of five flows.
 */

import { readFileSync } from 'node:fs';

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** Minimal RFC-4180 reader — the export quotes any field containing a comma. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** "Sep 2, 2026" -> "2026-09-02" (kept as a string; no timezone to get wrong). */
export function parseDate(s) {
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})$/.exec(s.trim());
  if (!m) throw new Error(`Unparseable date: ${s}`);
  const mo = MONTHS[m[1]];
  if (mo === undefined) throw new Error(`Unknown month: ${m[1]}`);
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Payees arrive with card-processor noise and trailing reference numbers. */
export function cleanPayee(raw) {
  let p = raw.trim();
  p = p.replace(/\s+/g, ' ');
  // Strip processor prefixes: "Sq *", "Tst*", "Py *", "Bcs*", "Aplpay ", "Sp "
  p = p.replace(/^(Sq|Tst|Py|Bcs|Sp|In|Pp|Wl|Ec)\s?\*\s?/i, '');
  p = p.replace(/^Aplpay\s+/i, '');
  // Strip trailing masked card / reference tails
  p = p.replace(/\s+X{2,}\d+$/i, '');
  p = p.replace(/\s+(Ppd|Web|Ccd|Arc|Tel)\s+Id:?\s*[\w#]*$/i, '');
  p = p.replace(/\s+Co\s+Entry\s+Descr:.*$/i, '');
  p = p.replace(/\s+Orig\s+Co\s+Name:.*$/i, '');
  p = p.replace(/\s+#\s*\d[\d\s]*$/, '');
  p = p.replace(/\s+\d{2}\/\d{2}$/, '');           // "... 09/02"
  p = p.replace(/\s+(Ending\s+In\s+\d+)$/i, '');
  p = p.replace(/^Atm\s+Withdrawal\b.*$/i, 'ATM Withdrawal');
  p = p.replace(/^Atm\s+Cash\s+Deposit\b.*$/i, 'ATM Deposit');
  p = p.replace(/\bXx[\dA-Z]+\b/gi, ' ');
  p = p.replace(/\s+/g, ' ');
  p = p.replace(/[\s*.,-]+$/, '');
  return p.trim() || raw.trim();
}

/**
 * Normalise a payee down to a merchant key for grouping and recurrence
 * detection. Store numbers, city suffixes and dates all collapse away.
 */
export function merchantKey(payee) {
  let k = payee.toLowerCase();
  k = k.replace(/[#*]/g, ' ');
  k = k.replace(/\b\d{3,}\b/g, ' ');               // store / ref numbers
  k = k.replace(/\b(az|ca|wa|tx|nv|ut|co|nm)\b\s*$/g, ' ');
  k = k.replace(/\b(llc|inc|corp|co|ltd|the)\b/g, ' ');
  k = k.replace(/[^a-z ]/g, ' ');
  k = k.replace(/\s+/g, ' ').trim();
  return k.split(' ').slice(0, 3).join(' ') || payee.toLowerCase();
}

export const FLOW = {
  INCOME: 'income',
  EXPENSE: 'expense',
  TRANSFER: 'transfer',
  SAVINGS: 'savings',
  ADJUSTMENT: 'adjustment',
};

const TRANSFER_CATEGORIES = new Set([
  'Transfer', 'Credit Card Payment', 'Mint Expense:Cash & Checks',
]);
const SAVINGS_CATEGORIES = [
  'Financial:Investment/Saving', 'Mint Expense:Investments',
];

/**
 * Decide what a row actually *is*.
 *
 * Order matters. Loan and property accounts are pseudo-accounts whose rows are
 * principal movements, never household cash flow. An explicit balance
 * adjustment is never spending. An account-named category is always a
 * transfer. Simplifi's own "exclude from reports" flag outranks the category
 * label — a $249k home-sale wire is tagged `Personal Income` in the export but
 * the user already marked it as not-really-income, and they are right.
 */
export function classify(tx, accountNames, investmentNames, nonCashflow) {
  const cat = tx.category;

  if (nonCashflow.has(tx.account)) return FLOW.ADJUSTMENT;
  if (cat === 'Balance Adjustment') return FLOW.ADJUSTMENT;

  // Category is the name of another account => this leg of a transfer.
  if (accountNames.has(cat)) return FLOW.TRANSFER;
  if (TRANSFER_CATEGORIES.has(cat)) return FLOW.TRANSFER;

  // Money moving into an investment vehicle is saving, not spending.
  if (investmentNames.has(cat)) return FLOW.SAVINGS;
  if (SAVINGS_CATEGORIES.some((c) => cat === c || cat.startsWith(`${c}:`))) {
    return FLOW.SAVINGS;
  }

  if (tx.excluded) return FLOW.TRANSFER;

  if (cat.startsWith('Personal Income') || cat.startsWith('Mint Income')) {
    return FLOW.INCOME;
  }

  return tx.amount > 0 ? FLOW.INCOME : FLOW.EXPENSE;
}

export function loadTransactions(csvPath, config) {
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const header = rows[0].map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const accountNames = new Set(rows.slice(1).map((r) => r[idx.Account].trim()));
  for (const a of config.accounts) accountNames.add(a.name);
  const investmentNames = new Set(config.investments.holdings.map((h) => h.name));
  // Investment accounts also show up as transaction accounts in the export.
  for (const n of ['Wealthfront Index', 'Fundrise Investment', 'Safety Net',
    'Health Savings Investments', 'Luke Roth IRA', 'Olivia Roth IRA',
    'Luke Traditional IRA', 'Olivia Traditional IRA',
    'Robinhood Investments(Imported)', 'Roth Contributory IRA(Imported)',
    'American Funds - Mutual(Imported)']) investmentNames.add(n);

  const fixes = (config.categoryFixes?.rules ?? []).map((r) => ({
    ...r, re: new RegExp(r.match, 'i'),
  }));
  const nonCashflow = new Set(config.nonCashflowAccounts ?? []);
  const oneTimeRules = (config.oneTimeEvents ?? []).map((r) => ({
    ...r, re: new RegExp(r.match, 'i'),
  }));

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[idx.Date]) continue;
    const rawPayee = r[idx.Payee] ?? '';
    const rawCategory = (r[idx.Category] ?? '').trim();
    const date = parseDate(r[idx.Date]);

    let category = rawCategory;
    let recategorised = null;
    let flowOverride = null;
    for (const f of fixes) {
      if (!f.re.test(rawPayee)) continue;
      if (f.date && f.date !== date) continue;
      if (f.category) { category = f.category; recategorised = rawCategory; }
      if (f.flow) flowOverride = f.flow;
      break;
    }

    const tx = {
      date,
      account: r[idx.Account].trim(),
      payee: cleanPayee(rawPayee),
      rawPayee: rawPayee.trim(),
      category,
      recategorised,
      excluded: (r[idx.Exclusion] ?? '').trim() === 'yes',
      amount: Number((r[idx.Amount] ?? '0').replace(/[$,\s]/g, '')),
    };
    if (!Number.isFinite(tx.amount)) continue;
    tx.merchant = merchantKey(tx.payee);
    tx.flow = flowOverride ?? classify(tx, accountNames, investmentNames, nonCashflow);

    // One-time house-transition money. Left in the ledger and shown on its own
    // timeline, but kept out of every trailing average — otherwise a $249k
    // wire reads as a raise and a $108k down payment reads as a spending month.
    const oneTime = oneTimeRules.find(
      (r) => r.re.test(rawPayee) && (!r.date || r.date === date),
    );
    if (oneTime) {
      tx.oneTime = true;
      tx.eventLabel = oneTime.label;
      tx.eventNote = oneTime.note ?? null;
    }
    out.push(tx);
  }

  // Hand-entered rows for accounts whose feed is gone. Same shape as everything
  // else, flagged so the UI can say where they came from.
  for (const m of config.manualTransactions ?? []) {
    out.push({
      ...m,
      rawPayee: m.payee,
      recategorised: null,
      excluded: m.flow === 'transfer',
      merchant: merchantKey(m.payee),
      source: 'manual',
    });
  }

  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { transactions: out, accountNames, investmentNames };
}
