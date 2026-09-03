/**
 * Committed monthly outgoings: everything that leaves by standing instruction
 * rather than by decision, in one reviewable list.
 *
 * Three kinds, and they behave differently under pressure:
 *
 *  - Fixed obligations. The mortgage. Not negotiable this year.
 *  - Recurring charges. Subscriptions and bills, detected from the ledger.
 *    Utilities are recurring but not optional; subscriptions are both.
 *  - Standing savings transfers. These look like commitments and feel like
 *    virtue, but in a deficit they are the easiest thing in the list to stop —
 *    and stopping them costs nothing today.
 *
 * Amounts come from the ledger where a feed exists. Payroll deductions never
 * appear in bank data, so those are read from the direct-deposit receipts and
 * marked as such: the dashboard should not imply it is watching something it
 * cannot see.
 */

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

/** What the ledger actually shows a standing transfer running at, recently. */
function observed(transactions, payeeMatch, months) {
  if (!payeeMatch) return null;
  const re = new RegExp(payeeMatch, 'i');
  const set = new Set(months);
  const byMonth = new Map();
  for (const t of transactions) {
    if (!re.test(t.rawPayee ?? t.payee)) continue;
    const m = t.date.slice(0, 7);
    if (!set.has(m)) continue;
    byMonth.set(m, (byMonth.get(m) ?? 0) + -t.amount);
  }
  return months.map((m) => round(byMonth.get(m) ?? 0));
}

export function commitments(config, payload, transactions) {
  const m = config.mortgage;
  const bd = m.buydown;
  const c = config.commitments;
  const recent = payload.meta.months.slice(-13);
  const pay = payload.paycheck.household;

  const groups = [];

  // ── Housing ───────────────────────────────────────────────────────────────
  groups.push({
    key: 'housing',
    title: 'Housing',
    subtitle: 'Fixed. Rises twice between now and late 2027.',
    flexibility: 'none',
    items: [
      {
        name: 'Mortgage — principal & interest',
        monthly: round(bd.borrowerPI),
        source: 'Closing Disclosure',
        note: `${(bd.effectiveRate * 100).toFixed(3)}% while the lender's buydown holds; `
          + `${(m.rate * 100).toFixed(3)}% from Sep 2027`,
        locked: true,
      },
      {
        name: 'Mortgage — escrow',
        monthly: round(m.escrow.totalMonthly),
        source: 'Closing Disclosure',
        note: 'Property tax and homeowners insurance. Funded on the pre-sale assessment, '
          + 'so it will rise at the next reassessment.',
        locked: true,
      },
    ],
  });

  // ── Standing savings transfers ────────────────────────────────────────────
  const savings = (c?.savings ?? []).map((s) => {
    const series = observed(transactions, s.payeeMatch, recent);
    const last3 = series ? series.slice(-4, -1) : null;
    return {
      name: s.name,
      monthly: round(s.now),
      was: round(s.was ?? s.now),
      status: s.status,
      kind: s.kind,
      cutCandidate: !!s.cutCandidate,
      verify: !!s.verify,
      note: s.note,
      series,
      observedRecent: last3 && last3.length
        ? round(last3.reduce((a, b) => a + b, 0) / last3.length) : null,
      source: s.payeeMatch ? 'Ledger' : 'Stated',
    };
  });

  groups.push({
    key: 'savings',
    title: 'Standing savings transfers',
    subtitle: 'Stoppable today, at no cost today. The first place to look.',
    flexibility: 'high',
    items: savings,
  });

  // Costs the new house needs that the twelve-month baseline has not seen yet.
  // Adding them explicitly keeps the forecast from being quietly optimistic.
  const planned = (c?.planned ?? []).map((x) => ({
    name: x.name,
    monthly: round(x.monthly),
    startsOn: x.startsOn,
    planned: true,
    note: x.note,
    source: 'Stated',
  }));
  if (planned.length) {
    groups.push({
      key: 'planned',
      title: 'Starting now',
      subtitle: 'New services the house needs. Not in the measured baseline, so added on top.',
      flexibility: 'low',
      items: planned,
    });
  }

  // ── Payroll deductions ────────────────────────────────────────────────────
  const periods = config.income.periodsPerYear ?? 26;
  groups.push({
    key: 'payroll',
    title: 'Taken from pay before it lands',
    subtitle: 'Invisible to the bank feed. Read from the direct-deposit receipts.',
    flexibility: 'low',
    items: (c?.payroll ?? []).map((x) => ({
      name: x.name,
      monthly: round((x.perPeriod ? x.now * periods : x.now * 12) / 12),
      perPeriod: x.perPeriod ? round(x.now) : null,
      locked: !!x.locked,
      verify: !!x.verify,
      kind: x.kind,
      note: x.note,
      source: 'Paystub',
    })),
  });

  // ── Detected recurring charges ────────────────────────────────────────────
  const detected = (payload.recurring ?? []).filter((r) => r.status === 'active');
  const isUtility = (r) => /utilit|electric|gas|water|trash|internet|insurance|liberty|aps|parks|centurylink|starlink|sage home/i
    .test(`${r.label} ${r.category}`);

  groups.push({
    key: 'utilities',
    title: 'Utilities and services',
    subtitle: 'Recurring and effectively fixed. Likely to rise: bigger house, and a pool.',
    flexibility: 'low',
    items: detected.filter(isUtility).map((r) => ({
      name: r.label,
      monthly: round(r.annual / 12),
      cadence: r.cadence,
      each: round(r.amount),
      variable: r.kind === 'variable',
      range: r.kind === 'variable' ? [r.low, r.high] : null,
      category: r.category,
      nextDue: r.nextDue,
      source: 'Detected',
    })),
  });

  groups.push({
    key: 'subscriptions',
    title: 'Subscriptions and memberships',
    subtitle: 'Every one of these is a decision you could revisit this afternoon.',
    flexibility: 'high',
    items: detected.filter((r) => !isUtility(r) && r.kind === 'fixed').map((r) => ({
      name: r.label,
      monthly: round(r.annual / 12),
      annual: round(r.annual),
      cadence: r.cadence,
      each: round(r.amount),
      category: r.category,
      nextDue: r.nextDue,
      priceChange: r.priceChange,
      source: 'Detected',
    })),
  });

  for (const g of groups) {
    g.monthly = round(g.items.reduce((s, i) => s + i.monthly, 0));
    g.annual = round(g.monthly * 12);
  }

  const total = round(groups.reduce((s, g) => s + g.monthly, 0));
  const stoppable = round(groups
    .filter((g) => g.flexibility === 'high')
    .reduce((s, g) => s + g.monthly, 0));

  // What the changes already made are worth.
  const ended = (c?.ended ?? []).map((x) => ({
    ...x, monthly: 0, was: round(x.was), source: 'Ledger',
  }));
  const changed = [
    ...savings.filter((s) => s.status === 'stopped' || s.status === 'reduced'),
    ...ended,
  ];
  const alreadySaved = round(changed.reduce((s, x) => s + (x.was - x.monthly), 0));
  const plannedMonthly = round(planned.reduce((s, x) => s + x.monthly, 0));
  const remainingCandidates = round(savings
    .filter((s) => s.cutCandidate || s.verify)
    .reduce((s, x) => s + x.monthly, 0));

  return {
    asOf: c?.asOf ?? payload.meta.asOf,
    note: c?.note,
    groups,
    total,
    stoppable,
    alreadySaved,
    changed,
    ended,
    planned,
    plannedMonthly,
    remainingCandidates,
    months: recent,
    takeHomeShare: round((total / Math.max(1, pay.monthlyNet)) * 100, 1),
  };
}
