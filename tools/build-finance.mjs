#!/usr/bin/env node
/**
 * Build the dashboard payload from the private Simplifi export + config,
 * then encrypt it. Only the encrypted output is ever written into the repo.
 *
 *   node tools/build-finance.mjs                 # reads FINANCE_PASSPHRASE
 *   FINANCE_PASSPHRASE='…' npm run finance
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';

import { FLOW } from './finance/parse.mjs';
import { loadLedger } from './finance/ledger.mjs';
import { paycheckModel } from './finance/paycheck.mjs';
import {
  monthOf, topCat, monthRange, monthlySeries, categoryRollup, merchantRollup,
  detectRecurring, netWorthSeries, amortisation, budgetVsActual, anomalies,
  round, toTime, fromTime, median,
} from './finance/analyze.mjs';
import { encryptPayload, verifyPayload } from './finance/crypt.mjs';
import { buildRunsheet } from './finance/runsheet.mjs';
import { affordability } from './finance/affordability.mjs';
import { commitments } from './finance/commitments.mjs';
import { houseCompare } from './finance/housecompare.mjs';
import { moveCosts } from './finance/movecosts.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'finance-private');
const OUT_DIR = path.join(ROOT, 'public', 'finances');
const OUT_FILE = path.join(OUT_DIR, 'data.enc.json');

const config = JSON.parse(readFileSync(path.join(SRC, 'config.json'), 'utf8'));
const statsPath = path.join(SRC, 'ledger.stats.json');
const ledgerStats = existsSync(statsPath)
  ? JSON.parse(readFileSync(statsPath, 'utf8')) : null;
const ledgerPath = path.join(SRC, 'ledger.jsonl');

// The dashboard is built from the canonical ledger, never from the raw exports
// — those are inputs to `npm run finance:import`, which is where deduplication
// and identity live. Building from the store means the numbers cannot change
// just because a different set of CSVs happens to be sitting in the folder.
const store = loadLedger(ledgerPath);
if (!store.size) {
  console.error(`\n  Ledger is empty: ${ledgerPath}`);
  console.error('  Run `npm run finance:import` first.\n');
  process.exit(1);
}

const oneTimeRules = (config.oneTimeEvents ?? []).map((r) => ({
  ...r, re: new RegExp(r.match, 'i'),
}));

const transactions = [...store.values()]
  .map((t) => {
    const hit = oneTimeRules.find(
      (r) => r.re.test(t.rawPayee ?? t.payee) && (!r.date || r.date === t.date),
    );
    return hit
      ? { ...t, oneTime: true, eventLabel: hit.label, eventNote: hit.note ?? null }
      : t;
  })
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const sourceCounts = {};
for (const t of transactions) sourceCounts[t.source] = (sourceCounts[t.source] ?? 0) + 1;
const seam = config.sources?.seam;
const sourceSummary = { ...sourceCounts, seam };

const asOf = config.asOf;
const firstMonth = monthOf(transactions[0].date);
const lastMonth = monthOf(asOf);
const months = monthRange(firstMonth, lastMonth);

// Trailing windows. The last month is partial, so "trailing 12" ends with the
// last *complete* month to keep averages honest.
const completeMonths = months.slice(0, -1);
const t12 = completeMonths.slice(-12);
const t3 = completeMonths.slice(-3);

const monthly = monthlySeries(transactions, months);
const cats12 = categoryRollup(transactions, t12);
const catsAll = categoryRollup(transactions, completeMonths);
const merchants12 = merchantRollup(transactions, t12);
const recurring = detectRecurring(transactions, asOf);
const { series: netWorth, trustedFrom, trustBlame } = netWorthSeries(transactions, config, months, asOf);
const amort = amortisation(config.mortgage);

// Current-month spend per category, for budget rings.
const curMonth = lastMonth;
const curCats = new Map();
for (const t of transactions) {
  if (t.flow !== FLOW.EXPENSE || monthOf(t.date) !== curMonth) continue;
  const k = topCat(t.category);
  curCats.set(k, (curCats.get(k) ?? 0) + -t.amount);
}

// ── Headline numbers ────────────────────────────────────────────────────────

const now = netWorth[netWorth.length - 1];
const investTotal = config.investments.holdings.reduce((s, h) => s + h.balance, 0);
const cashTotal = config.accounts
  .filter((a) => a.class === 'asset').reduce((s, a) => s + a.balance, 0);
const cashOnHold = config.accounts.reduce((s, a) => s + (a.onHold ?? 0), 0);
const cashAvailable = round(cashTotal - cashOnHold);
const interestEarning = config.accounts
  .filter((a) => a.apy > 0)
  .map((a) => ({ name: a.name, balance: a.balance, apy: a.apy,
    annualInterest: round(a.balance * a.apy), interestYtd: a.interestYtd ?? null }));
const creditTotal = config.accounts
  .filter((a) => a.class === 'liability').reduce((s, a) => s + a.balance, 0);
const mortgageBalance = amort.find((r) => r.month === curMonth)?.balance
  ?? config.mortgage.originalPrincipal;
const propertyValue = config.realEstate[0].value;

// Trailing averages run on the ordinary ledger only. The house transition is
// real money but not a repeatable pattern, so it gets its own section rather
// than being smeared across a 12-month average.
const ordinary = transactions.filter((t) => !t.oneTime);
const monthlyOrdinary = monthlySeries(ordinary, months);
const ordT12 = monthlyOrdinary.filter((m) => t12.includes(m.month));
const avgIncome = round(ordT12.reduce((s, m) => s + m.income, 0) / 12);
const avgExpense = round(ordT12.reduce((s, m) => s + m.expense, 0) / 12);
const avgSavings = round(ordT12.reduce((s, m) => s + m.savings, 0) / 12);
const avgExpense3 = round(
  monthlyOrdinary.filter((m) => t3.includes(m.month))
    .reduce((s, m) => s + m.expense, 0) / 3,
);

// Payroll is the reliable income signal; the raw `income` flow also picks up
// one-off inflows like the home-sale wire, which would flatter the average.
const payroll = transactions.filter(
  (t) => t.flow === FLOW.INCOME && /payroll/i.test(t.rawPayee),
);
const payrollByMonth = new Map(months.map((m) => [m, 0]));
for (const t of payroll) {
  const m = monthOf(t.date);
  if (payrollByMonth.has(m)) payrollByMonth.set(m, payrollByMonth.get(m) + t.amount);
}
const payroll12 = payroll.filter((t) => t12.includes(monthOf(t.date)));
const payrollMonthly = round(payroll12.reduce((s, t) => s + t.amount, 0) / 12);

const pay = paycheckModel(config);
const statedMonthlyNet = pay.household.monthlyNet;

// ── The house: one-time spend since closing vs the ordinary baseline ────────

const closeDate = config.realEstate[0].closedOn;
const houseSpend = transactions.filter(
  (t) => t.flow === FLOW.EXPENSE && t.date >= closeDate
    && /^(Home|Utilities)/.test(t.category),
);
const projectMatches = config.houseProjects.items.map((p) => {
  if (!p.payeeMatch) return { ...p, matched: [], matchedTotal: p.amount };
  const re = new RegExp(p.payeeMatch, 'i');
  const matched = transactions.filter(
    (t) => t.flow === FLOW.EXPENSE && t.date >= config.realEstate[0].contractDate
      && re.test(t.rawPayee),
  );
  return {
    ...p,
    matched: matched.map((t) => ({ date: t.date, payee: t.payee, amount: round(-t.amount) })),
    matchedTotal: round(matched.reduce((s, t) => s + -t.amount, 0)),
  };
});

// Property-tax reality check: the escrow is built on the pre-sale assessment.
const AZ_EFFECTIVE_RATE = 0.0060;   // Maricopa County, owner-occupied, approx.
const escrowTaxAnnual = round(config.mortgage.escrow.propertyTaxMonthly * 12);
const likelyTaxAnnual = round(config.realEstate[0].purchasePrice * AZ_EFFECTIVE_RATE);
const escrowGap = round((likelyTaxAnnual - escrowTaxAnnual) / 12);

// ── Data quality ────────────────────────────────────────────────────────────
// A dashboard that quietly averages over a broken data feed is worse than no
// dashboard. Everything the numbers can't be trusted on gets said out loud.

const dq = [];

// 1. Payroll feed gaps. School-district pay is genuinely lumpy in summer, so
//    we compare each month against the same month a year earlier as well as
//    against the running median.
const payrollVals = [...payrollByMonth.entries()].filter(([m]) => m < curMonth);
const medPay = median(payrollVals.slice(-24).map(([, v]) => v).filter((v) => v > 0));
const gapMonths = payrollVals.slice(-18)
  .filter(([, v]) => v < medPay * 0.55)
  .map(([m, v]) => ({ month: m, amount: round(v) }));
if (gapMonths.length) {
  dq.push({
    severity: gapMonths.length > 3 ? 'serious' : 'warning',
    title: 'Payroll deposits look incomplete in some months',
    detail: `${gapMonths.length} of the last 18 months show payroll well below the `
      + `$${Math.round(medPay).toLocaleString()} median — ${gapMonths.map((g) => g.month).join(', ')}. `
      + 'Some of that is the genuine summer dip in district pay, but a run of low '
      + 'months usually means an account connection dropped. Trailing-12 income is '
      + 'understated by however much is missing.',
    months: gapMonths,
  });
}

// 2. Money that left the building without a destination on the balance sheet.
const unresolved = transactions.filter((t) => t.eventNote?.startsWith('UNRESOLVED'));
for (const t of unresolved) {
  dq.push({
    severity: 'serious',
    title: t.eventLabel,
    detail: t.eventNote.replace(/^UNRESOLVED:\s*/, ''),
    amount: round(t.amount),
    date: t.date,
  });
}

// 3. How much of recent spending has no category to sit in.
const recent = transactions.filter(
  (t) => t.flow === FLOW.EXPENSE && t12.includes(monthOf(t.date)),
);
const uncat = recent.filter((t) => /^Uncategorized/.test(t.category));
const uncatShare = recent.length
  ? round((uncat.reduce((s, t) => s + -t.amount, 0)
    / recent.reduce((s, t) => s + -t.amount, 0)) * 100, 1)
  : 0;
if (uncatShare > 3) {
  dq.push({
    severity: uncatShare > 10 ? 'warning' : 'good',
    title: `${uncatShare}% of the last year's spending is uncategorised`,
    detail: `${uncat.length} transactions totalling `
      + `$${Math.round(uncat.reduce((s, t) => s + -t.amount, 0)).toLocaleString()}. `
      + 'Category totals below are understated by roughly that much.',
  });
}

// 4. Accounts that have stopped reporting.
// An account kept up by hand is not a broken feed — it is a chore with a date
// on it. The two need different wording because they need different responses.
const lastSeen = new Map();
for (const t of transactions) lastSeen.set(t.account, t.date);
for (const a of config.accounts) {
  if (a.manualUpdate) {
    const age = Math.round((toTime(asOf) - toTime(a.asOf ?? asOf)) / 86400000);
    dq.push({
      severity: age > 45 ? 'warning' : 'good',
      title: `${a.name} is updated by hand — last checked ${age === 0 ? 'today' : `${age} days ago`}`,
      detail: a.note ?? 'No automatic feed; the balance here is whatever was last typed in.',
    });
    continue;
  }
  const seen = lastSeen.get(a.name);
  const days = seen ? (toTime(asOf) - toTime(seen)) / 86400000 : Infinity;
  if (days > 75 && Math.abs(a.balance) > 100) {
    dq.push({
      severity: 'warning',
      title: `${a.name} has not reported a transaction in ${Number.isFinite(days) ? Math.round(days) : 'over 900'} days`,
      detail: `Balance is carried at $${a.balance.toLocaleString()}, but nothing has `
        + 'come through the feed. Either the account is dormant or the connection is stale.',
    });
  }
}

// 4b. Money that is on the balance sheet but not actually spendable yet.
const held = config.accounts.filter((a) => a.onHold > 0);
for (const a of held) {
  dq.push({
    severity: 'good',
    title: `$${a.onHold.toLocaleString()} of the ${a.name} balance is still on hold`,
    detail: a.holdNote ?? 'Counts toward net worth but cannot be spent yet.',
  });
}

// 5. How far back the reconstructed balance history can be trusted.
if (trustedFrom !== months[0]) {
  dq.push({
    severity: 'good',
    title: `Balance history starts ${trustedFrom}; spending history goes back to ${months[0]}`,
    detail: 'Historical balances are recovered by rolling today\'s figures backward through '
      + 'the ledger, which only works if every movement is recorded twice — once leaving '
      + 'the account, once arriving. Simplifi does that and flags the pair as a transfer. '
      + 'Mint recorded a credit-card payment only once, so rolled back through the Mint '
      + 'years the cards reconstruct to six-figure positive balances, which is impossible. '
      + `Net worth and balances are therefore charted from ${trustedFrom}. Spending, income, `
      + `categories and merchants do not depend on balances and use all ${months.length} `
      + `months back to ${months[0]}.`,
  });
}

// 6. Duplicate rows in the source exports.
// Mint recorded the same deposit twice — once as "AGUA FRIA UNION  PAYROLL"
// and once as "ORIG CO NAME:AGUA FRIA UNION  CO" — which inflated income and
// spending across the Mint years. These are collapsed at import.
if (ledgerStats?.duplicatesSuppressed) {
  dq.push({
    severity: 'good',
    title: `${ledgerStats.duplicatesSuppressed.toLocaleString()} duplicate rows removed from the source exports`,
    detail: 'Mint stored many transactions twice, once per bank feed, worded differently each '
      + 'time — most visibly every Agua Fria paycheque. Left in, they inflated reported income '
      + 'and spending through the Mint years without changing the net. They are collapsed when '
      + 'an export is imported, not when the dashboard is built, so the correction is permanent '
      + `and does not have to be re-derived. Last import ${ledgerStats.importedAt}.`,
  });
}

// 6b. Whatever inflation survived the deduplication.
{
  const yearIncome = new Map();
  const yearPayroll = new Map();
  for (const t of transactions) {
    const y = t.date.slice(0, 4);
    if (t.flow === FLOW.INCOME) yearIncome.set(y, (yearIncome.get(y) ?? 0) + t.amount);
    if (/payroll/i.test(t.rawPayee ?? '')) yearPayroll.set(y, (yearPayroll.get(y) ?? 0) + t.amount);
  }
  const inflated = [...yearIncome.entries()]
    .filter(([y, inc]) => {
      const p2 = yearPayroll.get(y) ?? 0;
      return p2 > 20000 && inc > p2 * 1.75 && y < seam.slice(0, 4);
    })
    .map(([y]) => y);

  if (inflated.length > 2) {
    dq.push({
      severity: 'warning',
      title: `Income still looks high against payroll in ${inflated.join(', ')}`,
      detail: 'Deduplication fixed most of this, but these years still record more income than '
        + 'payroll plausibly explains. The usual remainder is money moved between your own '
        + 'accounts that Mint filed as income on one side and spending on the other, which '
        + 'inflates both halves equally and leaves the net right.',
    });
  }
}

// 7. Withholding against a rough projection of what will actually be owed.
if (pay.tax && Math.abs(pay.tax.totalGap) > 1500) {
  const short = pay.tax.totalGap > 0;
  dq.push({
    severity: short ? 'serious' : 'warning',
    title: short
      ? `Tax withholding looks about $${Math.round(pay.tax.totalGap).toLocaleString()} short for ${pay.tax.assumptions.year}`
      : `Tax withholding looks about $${Math.abs(Math.round(pay.tax.totalGap)).toLocaleString()} more than needed`,
    detail: 'Olivia\'s receipt withholds no federal tax at all — state and FICA only — so the '
      + `household\'s entire federal withholding is Luke\'s $${Math.round(pay.tax.federalWithheld).toLocaleString()} a year. `
      + `Against roughly $${Math.round(pay.tax.federalOnWages).toLocaleString()} of projected federal tax on wages `
      + `(after an assumed ${pay.tax.assumptions.dependentChildren}-child credit), plus about `
      + `$${Math.round(pay.tax.federalOnGains).toLocaleString()} on the assumed gain from the July Wealthfront sale. `
      + 'Every input is an assumption and shown on the Paycheck page — this is arithmetic, not '
      + 'tax advice. Worth putting in front of whoever files the return.',
  });
}

// 8. Payroll still has the old address.
if (config.income.payrollAddressStale) {
  dq.push({
    severity: 'warning',
    title: 'Payroll still has the old address',
    detail: `${config.income.payrollAddressNote} Worth fixing before W-2s go out in January.`,
  });
}

// 9. Escrow built on the pre-sale tax assessment.
if (escrowGap > 40) {
  dq.push({
    severity: 'serious',
    title: 'Escrow is funded on the old tax assessment',
    detail: `The escrow collects $${escrowTaxAnnual.toLocaleString()}/yr for property tax — `
      + 'the 2025 figure, assessed before this sale and before the renovation. On an '
      + `$${config.realEstate[0].purchasePrice.toLocaleString()} purchase, Maricopa County is more likely `
      + `to bill around $${likelyTaxAnnual.toLocaleString()}/yr. Expect an escrow shortage notice and a `
      + `payment increase of roughly $${Math.round(escrowGap)}/mo once it reassesses.`,
  });
}

// Most-serious first: the reader should hit the things worth acting on before
// the things that are merely worth knowing.
const DQ_ORDER = { serious: 0, warning: 1, good: 2 };
dq.sort((a, b) => (DQ_ORDER[a.severity] ?? 3) - (DQ_ORDER[b.severity] ?? 3));

const oneTimeLedger = transactions
  .filter((t) => t.oneTime)
  .map((t) => ({
    date: t.date, label: t.eventLabel, note: t.eventNote,
    amount: round(t.amount), account: t.account, payee: t.payee,
  }));

// ── Dictionary-encode the ledger ────────────────────────────────────────────
// 18k rows of repeated strings compress far better as integer indices, and the
// browser gets a smaller parse.

const dict = { accounts: [], payees: [], categories: [], flows: [] };
const idOf = (list, v) => {
  let i = list.indexOf(v);
  if (i === -1) { i = list.length; list.push(v); }
  return i;
};
const dayZero = toTime(transactions[0].date);
const ledger = transactions.map((t) => [
  Math.round((toTime(t.date) - dayZero) / 86400000),
  idOf(dict.accounts, t.account),
  idOf(dict.payees, t.payee),
  idOf(dict.categories, t.category),
  idOf(dict.flows, t.flow),
  Math.round(t.amount * 100),
  t.excluded ? 1 : 0,
]);

// ── Payload ─────────────────────────────────────────────────────────────────

const payload = {
  meta: {
    generated: new Date().toISOString(),
    asOf,
    firstDate: transactions[0].date,
    lastDate: transactions[transactions.length - 1].date,
    txCount: transactions.length,
    dayZero: transactions[0].date,
    months,
    completeMonths,
    t12,
    trustedFrom,
    sources: sourceSummary,
    ledgerStats,
    trustedMonths: months.slice(months.indexOf(trustedFrom)),
    household: config.household,
  },
  headline: {
    netWorth: round(now.netWorth),
    liquid: round(now.liquid),
    cashTotal: round(cashTotal),
    creditTotal: round(creditTotal),
    investTotal: round(investTotal),
    propertyValue,
    mortgageBalance,
    homeEquity: round(propertyValue - mortgageBalance),
    avgIncome, avgExpense, avgSavings, avgExpense3,
    payrollMonthly, statedMonthlyNet,
    savingsRate: round((avgSavings / Math.max(1, statedMonthlyNet)) * 100, 1),
    // The bank ledger only sees net pay, so transfers to Wealthfront are the
    // small half of the saving. The pension, both 403(b)s, the HSA and the
    // employer match never touch a visible account.
    payrollSavingsMonthly: round(pay.household.trueSavingsAnnual / 12),
    trueSavingsMonthly: round(avgSavings + pay.household.trueSavingsAnnual / 12),
    trueSavingsRate: round(
      ((avgSavings * 12 + pay.household.trueSavingsAnnual)
        / Math.max(1, pay.household.annualGross)) * 100, 1),
    burnRate: avgExpense,
    cashOnHold: round(cashOnHold),
    cashAvailable,
    runwayMonths: round(round(cashTotal + creditTotal) / Math.max(1, avgExpense), 1),
    runwayMonthsAvailable: round(
      round(cashAvailable + creditTotal) / Math.max(1, avgExpense), 1),
    interestEarning,
    annualInterest: round(interestEarning.reduce((s2, x) => s2 + x.annualInterest, 0)),
    housingRatio: round(
      ((config.mortgage.buydown.borrowerPI + config.mortgage.escrow.totalMonthly)
        / Math.max(1, statedMonthlyNet)) * 100, 1),
  },
  dataQuality: dq,
  oneTimeEvents: oneTimeLedger,
  payrollByMonth: [...payrollByMonth.entries()].map(([m, v]) => ({ month: m, amount: round(v) })),
  monthlyOrdinary,
  monthly,
  netWorth,
  categories: { t12: cats12, all: catsAll },
  merchants: merchants12,
  recurring,
  budgets: budgetVsActual(cats12, config.budgets, 12, curCats),
  anomalies: anomalies(catsAll, completeMonths),
  accounts: config.accounts,
  investments: config.investments,
  realEstate: config.realEstate,
  soldHome: config.soldHome,
  taxReserve: config.taxReserve,
  privateLoans: config.privateLoans ?? [],
  income: config.income,
  paycheck: pay,
  mortgage: {
    ...config.mortgage,
    currentBalance: mortgageBalance,
    schedule: amort,
    totalInterest: round(amort.reduce((s, r) => s + r.interest, 0)),
    payoffMonth: amort[amort.length - 1].month,
  },
  house: {
    closeDate,
    projects: projectMatches,
    sinkingFunds: config.sinkingFunds,
    spendSinceClose: round(houseSpend.reduce((s, t) => s + -t.amount, 0)),
    taxCheck: {
      escrowTaxAnnual, likelyTaxAnnual, escrowGap,
      rate: AZ_EFFECTIVE_RATE,
      note: config.mortgage.escrow.taxBasisNote,
    },
  },
  ledger: { dict, rows: ledger },
};

payload.commitments = commitments(config, payload, transactions);
payload.houseCompare = houseCompare(config, payload, transactions);
payload.moveCosts = moveCosts(path.join(SRC, 'move-costs.csv'), config, transactions);
payload.affordability = affordability(config, payload, transactions, cats12);

// ── Encrypt & write ─────────────────────────────────────────────────────────

const passphrase = process.env.FINANCE_PASSPHRASE ?? await prompt();
const weak = checkPassphrase(passphrase);
if (weak) {
  console.error(`\n  Refusing to encrypt: ${weak}\n`);
  console.error('  The encrypted file goes into a PUBLIC repo. Iteration count slows an');
  console.error('  attacker down; it does not stop one. The passphrase is the actual lock.');
  console.error('  Use five or six random words — "copper-lantern-vivid-otter-marsh" style.');
  console.error('  That is easy to type, easy to remember, and not guessable.\n');
  process.exit(1);
}

/** Cheap entropy screen. Not a strength meter — a floor. */
function checkPassphrase(p) {
  if (!p) return 'no passphrase given';
  if (p.length < 20) return `only ${p.length} characters (20 minimum)`;
  const words = p.split(/[\s\-_.]+/).filter((w) => w.length > 2);
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(p)).length;
  if (words.length < 4 && classes < 3) {
    return 'too predictable — use 5+ random words, or mix cases, digits and symbols';
  }
  if (/^(password|passphrase|letmein|finance|money|budget)/i.test(p)) {
    return 'starts with a word an attacker would try first';
  }
  return null;
}

const json = JSON.stringify(payload);
const gz = gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
const enc = await encryptPayload(gz, passphrase);

// Decrypt what we just produced, with the passphrase as the shell actually
// handed it over, before anything is written. If the two disagree the file is
// unopenable and the only place to find that out is the browser, an hour later.
const verified = await verifyPayload(enc, passphrase);
if (!verified) {
  console.error('\n  Encryption verification FAILED — refusing to write the file.');
  console.error('  The blob did not decrypt with the passphrase it was just built from,');
  console.error('  which should be impossible. Do not publish; report this.\n');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(enc));

// The runsheet is regenerated every build so it cannot drift from the
// dashboard. It stays in the private directory — it is plain text.
const runsheetPath = path.join(SRC, 'RUNSHEET.md');
writeFileSync(runsheetPath, buildRunsheet(payload));
// The cleartext payload is a debugging aid, not an output. It lands in the
// gitignored private directory and only when explicitly requested.
if (process.env.FINANCE_DEBUG) {
  writeFileSync(path.join(SRC, 'payload.debug.json'), JSON.stringify(payload, null, 2));
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`
  Finance payload built
  ─────────────────────────────────────────────
  transactions   ${payload.meta.txCount.toLocaleString()}  (${payload.meta.firstDate} → ${payload.meta.lastDate})
  sources        ${Object.entries(sourceCounts).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(' · ')}  (seam ${config.sources?.seam})
  trusted from   ${trustedFrom}${trustBlame ? `  (limited by ${trustBlame.account} at $${trustBlame.value.toLocaleString()} in ${trustBlame.month})` : ''}
  months         ${months.length}
  categories     ${cats12.length} active in the last 12 months
  recurring      ${recurring.length} detected
  data flags     ${dq.length}
  household      $${pay.household.annualGross.toLocaleString()} gross · $${pay.household.annualNet.toLocaleString()} net
  true saving    $${pay.household.trueSavingsAnnual.toLocaleString()}/yr (${pay.household.trueSavingsRateOfGross}% of gross)
  tax gap        $${pay.tax ? Math.round(pay.tax.totalGap).toLocaleString() : 'n/a'}
  json           ${kb(json.length)}
  gzipped        ${kb(gz.length)}
  encrypted      ${kb(JSON.stringify(enc).length)}   → public/finances/data.enc.json
  runsheet       finance-private/RUNSHEET.md
  verified       decrypts with the passphrase given (${verified.meta.txCount.toLocaleString()} rows read back)

  affordability  $${payload.affordability.sustainableIncome.toLocaleString()} in · $${payload.affordability.housingNow.toLocaleString()} housing · $${payload.affordability.baseline.toLocaleString()} everything else
                 operating gap today $${payload.affordability.scenarios[0].surplus.toLocaleString()} · late 2027 $${payload.affordability.scenarios[2].surplus.toLocaleString()}
                 standing transfers $${payload.affordability.savingsNow.toLocaleString()}/mo (was $${payload.affordability.savingsTrailing.toLocaleString()})
                 max realistic trim $${payload.affordability.maxTrim.toLocaleString()} → still $${payload.affordability.afterMaxTrimNow.toLocaleString()} today, $${payload.affordability.afterMaxTrimLater.toLocaleString()} in late 2027
  commitments    $${payload.commitments.total.toLocaleString()}/mo committed · $${payload.commitments.stoppable.toLocaleString()}/mo stoppable
  old vs new     $${payload.houseCompare.totalBefore.toLocaleString()} → $${payload.houseCompare.totalAfter.toLocaleString()}/mo  (${payload.houseCompare.change > 0 ? '+' : ''}$${payload.houseCompare.change.toLocaleString()})${payload.moveCosts ? `
  move budget    $${payload.moveCosts.total.toLocaleString()} listed · $${payload.moveCosts.excludingTransaction.toLocaleString()} beyond the transaction itself` : ''}

  net worth      $${payload.headline.netWorth.toLocaleString()}
  liquid         $${payload.headline.liquid.toLocaleString()}
  home equity    $${payload.headline.homeEquity.toLocaleString()}
`);

function prompt() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question('  Passphrase: ', (a) => { rl.close(); res(a); }));
}
