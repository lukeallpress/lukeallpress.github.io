/**
 * Affordability: can this house be carried, and what has to change?
 *
 * The honest version of this question is not "what is the mortgage payment" but
 * "what is left after the mortgage and everything else that already happens".
 * So the baseline here is measured, not budgeted: what the household actually
 * spent over the last twelve months, with the old housing cost stripped out and
 * the new one put in its place.
 *
 * Two adjustments matter and are easy to miss:
 *
 *  - Take-home overstates sustainable income while one paycheque withholds no
 *    federal tax. That money is owed, it just has not been collected yet, so it
 *    is subtracted here rather than being allowed to look like income.
 *  - Money moved into investments is not spending, but in a deficit it is not
 *    saving either — it is the house proceeds being recycled. It is shown as its
 *    own line so it can be seen for what it is.
 */

const round = (n, p = 0) => Math.round(n * 10 ** p) / 10 ** p;

/** Categories a household can move on quickly, in the order it usually does. */
const FLEXIBILITY = {
  'Dining & Drinks': { flex: 0.5, note: 'Mostly small fast-food runs rather than occasions' },
  Shopping: { flex: 0.35, note: 'Amazon, Apple and Target make up most of it' },
  Travel: { flex: 0.5, note: 'Lumpy, and the most deferrable line here' },
  Entertainment: { flex: 0.4, note: 'Tickets, events, streaming' },
  Groceries: { flex: 0.12, note: 'Real room exists but it is slow and unpleasant work' },
  'Personal Care': { flex: 0.35, note: '' },
  Gifts: { flex: 0.3, note: '' },
  'Auto & Transport': { flex: 0.15, note: 'Fuel and insurance are close to fixed' },
  Kids: { flex: 0.05, note: 'Almost entirely school and childcare' },
  Utilities: { flex: 0.05, note: 'And likely to rise: bigger house, plus a pool' },
  Health: { flex: 0, note: '' },
  Taxes: { flex: 0, note: '' },
  'Charity & Donations': { flex: 0.5, note: 'A values call, not a maths one' },
};

/** Housing lines in the old ledger that the new mortgage replaces. */
const OLD_HOUSING = /nova|home loans|solare ranch|service\* general buye/i;

export function affordability(config, payload, transactions, catRollup) {
  const H = payload.headline;
  const m = config.mortgage;
  const bd = m.buydown;
  const pay = payload.paycheck.household;
  const tax = payload.paycheck.tax;
  const t12 = new Set(payload.meta.t12);

  // Baseline: what was actually spent, minus the housing it no longer pays for.
  let oldHousing = 0;
  const byCategory = new Map();
  for (const t of transactions) {
    if (t.flow !== 'expense') continue;
    if (!t12.has(t.date.slice(0, 7))) continue;
    const amt = -t.amount;
    if (t.category === 'Home:Mortgage' || t.category === 'Home:HOA Dues'
      || OLD_HOUSING.test(t.rawPayee ?? t.payee)) {
      oldHousing += amt;
      continue;
    }
    const top = (t.category || 'Uncategorized').split(':')[0];
    byCategory.set(top, (byCategory.get(top) ?? 0) + amt);
  }

  const baseline = round([...byCategory.values()].reduce((s, v) => s + v, 0) / 12);
  const oldHousingMonthly = round(oldHousing / 12);

  const housingNow = round(bd.borrowerPI + m.escrow.totalMonthly);
  const housingLater = round(
    m.monthlyPI + m.escrow.totalMonthly + payload.house.taxCheck.escrowGap,
  );

  // Income, adjusted for tax that is owed but not being withheld.
  const takeHome = round(pay.monthlyNet);
  const withholdingShortfall = tax && tax.totalGap > 0 ? round(tax.totalGap / 12) : 0;
  const sustainableIncome = round(takeHome - withholdingShortfall);

  const scenarios = [
    {
      key: 'now', label: 'Today',
      housing: housingNow,
      note: `While the lender's buydown holds the payment at ${bd.borrowerPI.toFixed(2)}`,
    },
    {
      key: 'buydown', label: 'From Sep 2027',
      housing: round(m.monthlyPI + m.escrow.totalMonthly),
      note: 'Buydown expires; the note rate applies in full',
    },
    {
      key: 'reassessed', label: 'After reassessment too',
      housing: housingLater,
      note: 'Escrow catches up with the post-sale tax bill',
    },
  ].map((s) => ({
    ...s,
    baseline,
    income: sustainableIncome,
    surplus: round(sustainableIncome - s.housing - baseline),
    housingShare: round((s.housing / sustainableIncome) * 100, 1),
  }));

  const gap = -scenarios[2].surplus;

  // Levers, in the order a household would actually reach for them.
  const levers = [];

  const investing = round(Math.max(0, H.avgSavings));
  if (investing > 50) {
    levers.push({
      name: 'Pause the taxable investing',
      monthly: investing,
      kind: 'immediate',
      note: 'Not a spending cut — this is money moved to Wealthfront and Fundrise. In a '
        + 'deficit it is not saving, it is recycling the house proceeds. The pension, both '
        + '403(b)s and the HSA are untouched by this and keep running.',
    });
  }

  for (const c of catRollup) {
    const f = FLEXIBILITY[c.name];
    if (!f || f.flex <= 0) continue;
    const monthly = round(c.avgMonth * f.flex);
    if (monthly < 25) continue;
    levers.push({
      name: `Trim ${c.name} by ${Math.round(f.flex * 100)}%`,
      monthly,
      kind: 'behavioural',
      from: round(c.avgMonth),
      to: round(c.avgMonth * (1 - f.flex)),
      note: f.note,
    });
  }

  levers.sort((a, b) => b.monthly - a.monthly);

  // How far down the list you have to go to close the gap.
  let running = 0;
  for (const l of levers) {
    running += l.monthly;
    l.cumulative = round(running);
    l.closesGap = running >= gap;
  }
  const enough = levers.findIndex((l) => l.closesGap);

  // Charges that recur and could simply stop.
  const cuttable = (payload.recurring ?? [])
    .filter((r) => r.status === 'active' && r.kind === 'fixed')
    .filter((r) => !/utilit|electric|gas|water|trash|internet|insurance|liberty|aps|parks|centurylink|starlink/i
      .test(`${r.label} ${r.category}`))
    .map((r) => ({ ...r, monthly: round(r.annual / 12, 2) }))
    .sort((a, b) => b.annual - a.annual);

  return {
    baseline,
    oldHousingMonthly,
    housingNow,
    housingLater,
    housingIncrease: round(housingNow - oldHousingMonthly),
    housingIncreaseLater: round(housingLater - oldHousingMonthly),
    takeHome,
    withholdingShortfall,
    sustainableIncome,
    scenarios,
    gap,
    levers,
    leversNeeded: enough === -1 ? levers.length : enough + 1,
    coverable: enough !== -1,
    cuttable,
    cuttableAnnual: round(cuttable.reduce((s, r) => s + r.annual, 0)),
    categories: [...byCategory.entries()]
      .map(([name, total]) => ({
        name,
        monthly: round(total / 12),
        flex: FLEXIBILITY[name]?.flex ?? 0,
      }))
      .sort((a, b) => b.monthly - a.monthly),
  };
}
