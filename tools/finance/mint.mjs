/**
 * Reader for the Mint export, which covers May 2012 → Feb 2024.
 *
 * Mint and Simplifi overlap from Jan 2020 to Feb 2024, but they are not equally
 * good over that window: Simplifi's pre-2024 rows are a partial backfill and
 * run about 20–25% short of Mint's month by month. That gap is exactly what
 * broke the balance reconstruction — rolled backward through an incomplete
 * ledger, the credit cards ended up with a large positive balance.
 *
 * So rather than merging and deduplicating, we cut at the seam: Mint owns
 * everything up to the day it stopped recording, Simplifi owns everything
 * after. Each source is used over the period it was the live system.
 */

import { readFileSync } from 'node:fs';
import { parseCsv, cleanPayee, merchantKey, FLOW } from './parse.mjs';

/** Mint writes m/d/yyyy. */
function parseMintDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) throw new Error(`Unparseable Mint date: ${s}`);
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Mint's taxonomy, mapped onto the one the rest of the dashboard speaks. */
const CATEGORY_MAP = {
  'Food & Dining': 'Dining & Drinks',
  Groceries: 'Groceries',
  Shopping: 'Shopping',
  'Auto & Transport': 'Auto & Transport',
  'Bills & Utilities': 'Utilities',
  'Travel & Vacation': 'Travel',
  Entertainment: 'Entertainment',
  Donations: 'Charity & Donations',
  'Home & Garden': 'Home',
  'Mortgage & Rent': 'Home:Mortgage',
  Medical: 'Health',
  'Health & Fitness': 'Fitness',
  'Fees & Charges': 'Fees & Charges',
  Kids: 'Kids',
  'Personal Care': 'Personal Care',
  'Business Services': 'Business Services',
  Gifts: 'Gifts',
  Education: 'Education',
  Taxes: 'Taxes',
  Pets: 'Pets',
  Loans: 'Loans',
  'Cash & Checks': 'Cash & ATM',
  'Misc Expenses': 'Uncategorized',
  Uncategorized: 'Uncategorized',
  Transfer: 'Transfer',
  Investments: 'Financial:Investment/Saving',
  Income: 'Personal Income',
  Hide: 'Hidden',
};

/** Account labels drifted between the two apps; this is the reconciliation. */
const ACCOUNT_MAP = {
  'Blue Cash Preferred®': 'AMEX Blue Cash Preferred',
  'Alaska Airlines Visa Signature': 'Alaska Airlines Visa Signature BoA',
  'Health Savings Account -  VSEBG AGUA FRIA HIGH SCHOOL DISTRICT': 'HSA Checking',
  'Roth Contributory IRA': 'Luke Roth IRA',
};

const FLOW_BY_CATEGORY = {
  Transfer: FLOW.TRANSFER,
  Investments: FLOW.SAVINGS,
  Income: FLOW.INCOME,
  Hide: FLOW.ADJUSTMENT,
};

export function loadMint(csvPath, config, until) {
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const header = rows[0].map((x) => x.trim());
  const idx = Object.fromEntries(header.map((x, i) => [x, i]));
  const nonCashflow = new Set(config.nonCashflowAccounts ?? []);

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[idx.Date]) continue;
    const date = parseMintDate(r[idx.Date]);
    if (until && date > until) continue;

    const rawCategory = (r[idx.Category] ?? '').trim();
    if (rawCategory === 'Hide') continue;

    const account = ACCOUNT_MAP[r[idx['Account Name']].trim()]
      ?? r[idx['Account Name']].trim();
    const rawPayee = (r[idx.Description] || r[idx['Original Description']] || '').trim();

    // Mint stores magnitude in Amount and direction in Transaction Type.
    const magnitude = Number((r[idx.Amount] ?? '0').replace(/[$,\s]/g, ''));
    if (!Number.isFinite(magnitude)) continue;
    const amount = r[idx['Transaction Type']].trim() === 'credit' ? magnitude : -magnitude;

    const tx = {
      date,
      account,
      payee: cleanPayee(rawPayee),
      rawPayee,
      category: CATEGORY_MAP[rawCategory] ?? rawCategory ?? 'Uncategorized',
      recategorised: null,
      excluded: rawCategory === 'Transfer' || rawCategory === 'Hide',
      amount,
      source: 'mint',
    };
    tx.merchant = merchantKey(tx.payee);

    if (nonCashflow.has(tx.account)) tx.flow = FLOW.ADJUSTMENT;
    else tx.flow = FLOW_BY_CATEGORY[rawCategory] ?? (amount > 0 ? FLOW.INCOME : FLOW.EXPENSE);

    out.push(tx);
  }
  return out;
}
