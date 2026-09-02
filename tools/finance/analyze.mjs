/**
 * Everything the dashboard shows is computed here, at build time, so the
 * browser only ever renders — no 18k-row aggregation on the main thread.
 */

import { FLOW } from './parse.mjs';

export const monthOf = (d) => d.slice(0, 7);
export const topCat = (c) => (c || 'Uncategorized').split(':')[0];
export const subCat = (c) => {
  const p = (c || 'Uncategorized').split(':');
  return p.length > 1 ? p.slice(1).join(':') : '—';
};

const DAY = 86400000;
export const toTime = (d) => Date.parse(`${d}T00:00:00Z`);
export const fromTime = (t) => new Date(t).toISOString().slice(0, 10);
const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

/** Inclusive list of YYYY-MM between two dates. */
export function monthRange(startMonth, endMonth) {
  const out = [];
  let [y, m] = startMonth.split('-').map(Number);
  const [ey, em] = endMonth.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

const lastDayOf = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

// ── Monthly cash-flow ───────────────────────────────────────────────────────

export function monthlySeries(transactions, months) {
  const blank = () => ({
    income: 0, expense: 0, savings: 0, transfers: 0, count: 0,
  });
  const byMonth = new Map(months.map((m) => [m, blank()]));

  for (const t of transactions) {
    const b = byMonth.get(monthOf(t.date));
    if (!b) continue;
    b.count++;
    if (t.flow === FLOW.INCOME) b.income += t.amount;
    else if (t.flow === FLOW.EXPENSE) b.expense += -t.amount;
    else if (t.flow === FLOW.SAVINGS) b.savings += -t.amount;
    else if (t.flow === FLOW.TRANSFER) b.transfers += Math.abs(t.amount);
  }

  return months.map((m) => {
    const b = byMonth.get(m);
    return {
      month: m,
      income: round(b.income),
      expense: round(b.expense),
      savings: round(b.savings),
      net: round(b.income - b.expense),
      count: b.count,
    };
  });
}

// ── Category rollups ────────────────────────────────────────────────────────

export function categoryRollup(transactions, months) {
  const monthSet = new Set(months);
  const cats = new Map();

  for (const t of transactions) {
    if (t.flow !== FLOW.EXPENSE) continue;
    const m = monthOf(t.date);
    if (!monthSet.has(m)) continue;
    const top = topCat(t.category);
    if (!cats.has(top)) {
      cats.set(top, { name: top, total: 0, count: 0, months: new Map(), subs: new Map() });
    }
    const c = cats.get(top);
    const amt = -t.amount;
    c.total += amt; c.count++;
    c.months.set(m, (c.months.get(m) ?? 0) + amt);

    const sub = subCat(t.category);
    if (!c.subs.has(sub)) c.subs.set(sub, { name: sub, total: 0, count: 0 });
    const s = c.subs.get(sub);
    s.total += amt; s.count++;
  }

  return [...cats.values()]
    .map((c) => ({
      name: c.name,
      total: round(c.total),
      count: c.count,
      avgMonth: round(c.total / months.length),
      series: months.map((m) => round(c.months.get(m) ?? 0)),
      subs: [...c.subs.values()]
        .sort((a, b) => b.total - a.total)
        .map((s) => ({ ...s, total: round(s.total) })),
    }))
    .sort((a, b) => b.total - a.total);
}

export function merchantRollup(transactions, months, limit = 80) {
  const monthSet = new Set(months);
  const m = new Map();
  for (const t of transactions) {
    if (t.flow !== FLOW.EXPENSE) continue;
    if (!monthSet.has(monthOf(t.date))) continue;
    if (!m.has(t.merchant)) {
      m.set(t.merchant, {
        key: t.merchant, label: t.payee, total: 0, count: 0,
        first: t.date, last: t.date, category: topCat(t.category),
      });
    }
    const e = m.get(t.merchant);
    e.total += -t.amount; e.count++;
    if (t.date < e.first) e.first = t.date;
    if (t.date > e.last) { e.last = t.date; e.label = t.payee; }
  }
  return [...m.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((e) => ({ ...e, total: round(e.total), avg: round(e.total / e.count) }));
}

// ── Recurring / subscription detection ──────────────────────────────────────

const CADENCES = [
  { days: 7, label: 'Weekly', perYear: 52 },
  { days: 14, label: 'Every 2 weeks', perYear: 26 },
  { days: 30.44, label: 'Monthly', perYear: 12 },
  { days: 60.9, label: 'Every 2 months', perYear: 6 },
  { days: 91.3, label: 'Quarterly', perYear: 4 },
  { days: 182.6, label: 'Twice a year', perYear: 2 },
  { days: 365.25, label: 'Yearly', perYear: 1 },
];

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * A charge is "recurring" when the same merchant hits on a regular cadence
 * with a stable amount. We look at gap regularity rather than just counting
 * hits, so 40 Amazon orders in a year don't read as a subscription.
 */
export function detectRecurring(transactions, asOf, lookbackDays = 550) {
  const cutoff = toTime(asOf) - lookbackDays * DAY;
  const groups = new Map();

  for (const t of transactions) {
    if (t.flow !== FLOW.EXPENSE) continue;
    if (toTime(t.date) < cutoff) continue;
    if (!groups.has(t.merchant)) groups.set(t.merchant, []);
    groups.get(t.merchant).push(t);
  }

  const found = [];
  for (const [key, txs] of groups) {
    if (txs.length < 3) continue;
    txs.sort((a, b) => toTime(a.date) - toTime(b.date));

    const gaps = [];
    for (let i = 1; i < txs.length; i++) {
      gaps.push((toTime(txs[i].date) - toTime(txs[i - 1].date)) / DAY);
    }
    const gap = median(gaps);
    if (gap < 5 || gap > 400) continue;

    // Gaps must actually be regular, not just averaging out.
    const gapSpread = median(gaps.map((g) => Math.abs(g - gap))) / gap;
    if (gapSpread > 0.35) continue;

    const amounts = txs.map((t) => -t.amount);
    const amt = median(amounts);
    if (amt < 1) continue;
    const amtSpread = median(amounts.map((a) => Math.abs(a - amt))) / amt;
    // A utility bill is just as recurring as a subscription; it simply doesn't
    // hold a flat price. Keep both, and say which is which.
    if (amtSpread > 0.75) continue;
    const kind = amtSpread <= 0.12 ? 'fixed' : 'variable';

    const cadence = CADENCES.reduce((best, c) =>
      Math.abs(Math.log(c.days / gap)) < Math.abs(Math.log(best.days / gap)) ? c : best);
    if (Math.abs(Math.log(cadence.days / gap)) > 0.3) continue;

    const last = txs[txs.length - 1];
    const nextDue = fromTime(toTime(last.date) + Math.round(gap) * DAY);
    const overdueBy = (toTime(asOf) - toTime(nextDue)) / DAY;
    const lastAmt = -last.amount;

    found.push({
      key,
      label: last.payee,
      category: topCat(last.category),
      cadence: cadence.label,
      amount: round(amt),
      lastAmount: round(lastAmt),
      annual: round(amt * cadence.perYear),
      count: txs.length,
      first: txs[0].date,
      last: last.date,
      nextDue,
      status: overdueBy > gap * 0.6 ? 'lapsed' : 'active',
      kind,
      spread: round(amtSpread, 3),
      low: round(Math.min(...amounts)),
      high: round(Math.max(...amounts)),
      priceChange: kind === 'fixed' && lastAmt > amt * 1.12 ? round(lastAmt - amt) : 0,
    });
  }

  // Live commitments first — a lapsed charge is history, not a bill to plan
  // around, and it should never head the list.
  return found.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return b.annual - a.annual;
  });
}

// ── Balance reconstruction ──────────────────────────────────────────────────

/**
 * Roll a known current balance backward through the ledger to recover
 * end-of-month history. Only meaningful for accounts whose every movement is
 * in the export — checking and credit cards. Savings and brokerage accounts
 * accrue interest and market value outside the transaction feed, so they are
 * held at their current value and labelled as such in the UI.
 */
export function reconstructBalances(transactions, account, asOf, months) {
  const txs = transactions
    .filter((t) => t.account === account.name && t.date <= asOf)
    .sort((a, b) => toTime(b.date) - toTime(a.date));

  const endOfMonth = new Map();
  let balance = account.balance;
  let i = 0;

  for (let mi = months.length - 1; mi >= 0; mi--) {
    const boundary = lastDayOf(months[mi]);
    while (i < txs.length && txs[i].date > boundary) {
      balance -= txs[i].amount;
      i++;
    }
    endOfMonth.set(months[mi], round(balance));
  }
  return endOfMonth;
}

/**
 * Net worth over time, assembled from what we can actually justify:
 *   • cash + credit  — reconstructed from the ledger (real)
 *   • investments    — current value walked back by known contributions and
 *                      withdrawals; market movement is NOT modelled
 *   • real estate    — step function at known valuations
 *   • mortgages      — amortised from the closing disclosure
 */
export function netWorthSeries(transactions, config, months, asOf) {
  const reconstructable = config.accounts.filter((a) => a.reconstruct);
  const flatAccounts = config.accounts.filter((a) => !a.reconstruct);

  const perAccount = new Map(
    reconstructable.map((a) => [a.name, reconstructBalances(transactions, a, asOf, months)]),
  );
  const flatTotal = flatAccounts.reduce((s, a) => s + a.balance, 0);

  // Investments: walk back through contribution / withdrawal flows.
  const investTotal = config.investments.holdings.reduce((s, h) => s + h.balance, 0);
  const investFlowByMonth = new Map(months.map((m) => [m, 0]));
  for (const t of transactions) {
    if (t.flow !== FLOW.SAVINGS) continue;
    const m = monthOf(t.date);
    if (investFlowByMonth.has(m)) {
      investFlowByMonth.set(m, investFlowByMonth.get(m) + -t.amount);
    }
  }

  const realEstate = config.realEstate[0];
  const sold = config.soldHome;
  const mort = config.mortgage;

  let investRunning = investTotal;
  const investAt = new Map();
  for (let i = months.length - 1; i >= 0; i--) {
    investAt.set(months[i], round(investRunning));
    investRunning -= investFlowByMonth.get(months[i]) ?? 0;
  }

  const amort = amortisation(mort);
  const mortAt = new Map(amort.map((r) => [r.month, r.balance]));

  const out = [];
  for (const m of months) {
    let cash = 0; let credit = 0;
    for (const a of reconstructable) {
      const v = perAccount.get(a.name).get(m) ?? 0;
      if (a.class === 'liability') credit += v; else cash += v;
    }
    cash += flatTotal;

    const eom = lastDayOf(m);
    let property = 0; let debt = 0;
    if (eom >= realEstate.closedOn) property += realEstate.value;
    if (eom < sold.soldOn) {
      property += sold.priorValueEstimate;
      debt -= sold.priorLoanBalance;
    }
    if (eom >= mort.firstPaymentDate) debt -= (mortAt.get(m) ?? mort.originalPrincipal);
    else if (eom >= mort.closedOn) debt -= mort.originalPrincipal;

    const investments = investAt.get(m);

    out.push({
      month: m,
      cash: round(cash),
      credit: round(credit),
      liquid: round(cash + credit),
      investments: round(investments),
      property: round(property),
      debt: round(debt),
      netWorth: round(cash + credit + investments + property + debt),
    });
  }

  return { series: out, trustedFrom: trustBoundary(months, reconstructable, perAccount) };
}

/**
 * Rolling a balance backward is only as good as the ledger behind it, and this
 * export is truncated at 2020-01-01 — so every gap before that accumulates into
 * the early history. The tell is a credit card reconstructing to a large
 * *positive* balance, which cannot happen: it means the export records more
 * payments than charges over the window.
 *
 * Rather than draw a line we know is wrong, find the earliest month from which
 * every account stays plausible all the way to today, and start there.
 */
function trustBoundary(months, accounts, perAccount) {
  const CREDIT_TOLERANCE = 250;    // a card can sit slightly in credit
  const ASSET_TOLERANCE = -2500;   // a checking account can be overdrawn

  let boundary = 0;
  for (let i = 0; i < months.length; i++) {
    let ok = true;
    for (const a of accounts) {
      const v = perAccount.get(a.name).get(months[i]);
      if (v === undefined) continue;
      if (a.class === 'liability' && v > CREDIT_TOLERANCE) { ok = false; break; }
      if (a.class === 'asset' && v < ASSET_TOLERANCE) { ok = false; break; }
    }
    if (!ok) boundary = i + 1;
  }
  return months[Math.min(boundary, months.length - 1)];
}

// ── Mortgage ────────────────────────────────────────────────────────────────

/** Full amortisation schedule, honouring a temporary buydown if present. */
export function amortisation(m) {
  const rate = m.rate / 12;
  const rows = [];
  let balance = m.originalPrincipal;
  let [y, mo] = m.firstPaymentDate.slice(0, 7).split('-').map(Number);

  const buydownMonths = m.buydown?.months ?? 0;

  for (let n = 1; n <= m.termMonths && balance > 0.005; n++) {
    const interest = balance * rate;
    // A buydown subsidises the *interest*; scheduled principal is unchanged.
    const principal = m.monthlyPI - interest;
    balance = Math.max(0, balance - principal);

    const outOfPocketPI = n <= buydownMonths ? m.buydown.borrowerPI : m.monthlyPI;
    rows.push({
      n,
      month: `${y}-${String(mo).padStart(2, '0')}`,
      payment: round(outOfPocketPI + m.escrow.totalMonthly),
      principal: round(principal),
      interest: round(interest),
      subsidy: n <= buydownMonths ? round(m.buydown.monthlySubsidy) : 0,
      escrow: round(m.escrow.totalMonthly),
      balance: round(balance),
    });
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  return rows;
}

// ── Budgets, anomalies ──────────────────────────────────────────────────────

export function budgetVsActual(catRollup, budgets, monthsCount, currentMonthCats) {
  const out = [];
  for (const c of catRollup) {
    const target = budgets[c.name];
    if (typeof target !== 'number') continue;
    out.push({
      name: c.name,
      target,
      actual: round(currentMonthCats.get(c.name) ?? 0),
      average: round(c.total / monthsCount),
    });
  }
  return out.sort((a, b) => b.actual / b.target - a.actual / a.target);
}

/**
 * Months where a category ran far above its own normal. Uses median + MAD so a
 * single huge month doesn't hide the next one.
 */
export function anomalies(catRollup, months, minAmount = 250) {
  const out = [];
  for (const c of catRollup) {
    const vals = c.series.filter((v) => v > 0);
    if (vals.length < 6) continue;
    const med = median(vals);
    const mad = median(vals.map((v) => Math.abs(v - med))) || med * 0.2;
    if (!mad) continue;
    c.series.forEach((v, i) => {
      const z = (v - med) / (mad * 1.4826);
      if (z > 3 && v - med > minAmount) {
        out.push({
          category: c.name, month: months[i],
          amount: round(v), typical: round(med), excess: round(v - med),
        });
      }
    });
  }
  return out.sort((a, b) => b.excess - a.excess).slice(0, 24);
}

export { median, round };
