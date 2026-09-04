/**
 * Refinance and recast scenarios.
 *
 * The instinct to wait a year is right, but not for the reason it is usually
 * given. Nothing in the note locks the loan in: there is no prepayment penalty
 * and no seasoning clause. What waiting protects is free money. Clause 7 of the
 * Temporary Buydown Agreement says that if the note is "prepaid in full" before
 * the whole subsidy has been disbursed, whatever is left goes back to UWM — and
 * a refinance is a prepayment in full. At $438.84 a month, walking away early
 * hands back roughly $440 for every month still to run.
 *
 * That same clause points at the better move. It is triggered by prepayment in
 * *full*. A partial prepayment followed by a recast — the lender re-amortises
 * the existing note over the remaining term at the existing rate — is not a
 * payoff. The buydown survives it, there are no closing costs, and there is no
 * new 30-year clock. It cannot lower the rate, so it is not a substitute for
 * refinancing; it is the thing to do first, and possibly the thing to do
 * instead if rates do not move.
 *
 * Every scenario here is arithmetic over stated assumptions. Rates a year out
 * are guesses, UWM's recast policy needs confirming, and none of this is
 * advice — it is the maths a conversation with a lender should start from.
 */

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

/** Standard amortising payment. */
export function payment(principal, annualRate, termMonths) {
  const r = annualRate / 12;
  if (r === 0) return principal / termMonths;
  return (principal * r) / (1 - (1 + r) ** -termMonths);
}

/** Balance after n payments of a loan that pays `pmt` each month. */
export function balanceAfter(principal, annualRate, pmt, n) {
  const r = annualRate / 12;
  let b = principal;
  for (let i = 0; i < n; i++) b = Math.max(0, b * (1 + r) - pmt);
  return b;
}

/** Total interest paid over the whole schedule. */
function totalInterest(principal, annualRate, pmt, termMonths) {
  const r = annualRate / 12;
  let b = principal;
  let interest = 0;
  for (let i = 0; i < termMonths && b > 0.005; i++) {
    const int = b * r;
    interest += int;
    b = Math.max(0, b + int - pmt);
  }
  return interest;
}

const addMonths = (ym, n) => {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
};

export function refinance(config, payload) {
  const m = config.mortgage;
  const bd = m.buydown;
  const cfg = config.refinance ?? {};
  const cashIn = cfg.cashIn ?? 80000;
  const asOfMonth = config.asOf.slice(0, 7);

  // Where the loan stands now, and where it stands when the subsidy runs out.
  const firstPayment = m.firstPaymentDate.slice(0, 7);
  const monthsElapsed = (Number(asOfMonth.slice(0, 4)) - Number(firstPayment.slice(0, 4))) * 12
    + (Number(asOfMonth.slice(5)) - Number(firstPayment.slice(5)));
  // The payment due on the 1st has been made by the time anyone reads this.
  const paymentsMade = Math.max(0,
    monthsElapsed + (config.asOf >= m.firstPaymentDate ? 1 : 0));
  const balanceNow = round(balanceAfter(m.originalPrincipal, m.rate, m.monthlyPI, paymentsMade));
  const buydownEnds = addMonths(firstPayment, bd.months);
  const balanceAtBuydownEnd = round(
    balanceAfter(m.originalPrincipal, m.rate, m.monthlyPI, bd.months),
  );
  const subsidyRemaining = round(Math.max(0, bd.months - paymentsMade) * bd.monthlySubsidy);
  const termLeftAtEnd = m.termMonths - bd.months;

  const escrowNow = m.escrow.totalMonthly;
  const escrowLater = round(escrowNow + payload.house.taxCheck.escrowGap);

  // What is being paid today, and what it becomes once the subsidy stops and
  // the county reassesses. Everything below is measured against that.
  const payingNow = round(bd.borrowerPI + escrowNow);
  const doNothingLater = round(m.monthlyPI + escrowLater);

  const closingRate = cfg.closingCostRate ?? 0.025;
  const recastFee = cfg.recastFee ?? 350;

  const scenarios = [];

  // ── Do nothing ────────────────────────────────────────────────────────────
  scenarios.push({
    key: 'nothing',
    label: 'Do nothing',
    when: 'Sep 2027',
    rate: m.rate,
    principal: balanceAtBuydownEnd,
    pi: round(m.monthlyPI),
    escrow: escrowLater,
    total: doNothingLater,
    cashIn: 0,
    cost: 0,
    keepsBuydown: true,
    term: termLeftAtEnd,
    totalInterestLeft: round(totalInterest(balanceAtBuydownEnd, m.rate, m.monthlyPI, termLeftAtEnd)),
    note: 'The baseline every other row is measured against.',
  });

  // ── Recast now ────────────────────────────────────────────────────────────
  // A partial prepayment is not a payoff, so clause 7 is not triggered and the
  // subsidy keeps being disbursed.
  const recastPrincipal = round(balanceNow - cashIn);
  const recastTermNow = m.termMonths - paymentsMade;
  const recastPI = round(payment(recastPrincipal, m.rate, recastTermNow));
  scenarios.push({
    key: 'recast-now',
    label: `Recast now, ${cashIn.toLocaleString()} in`,
    when: 'Within weeks',
    rate: m.rate,
    principal: recastPrincipal,
    pi: recastPI,
    escrow: escrowNow,
    total: round(recastPI + escrowNow),
    // The buydown subsidy is a fixed dollar schedule, so it should keep
    // applying against a smaller payment — worth confirming with UWM.
    subsidised: round(Math.max(0, recastPI - bd.monthlySubsidy) + escrowNow),
    // Compared on the same footing as everything else: Sep 2027, after the
    // county has reassessed. Escrow rises whatever is done about the loan, so
    // letting the recast row keep today's escrow would flatter it by $258.
    totalLater: round(recastPI + escrowLater),
    cashIn,
    cost: recastFee,
    keepsBuydown: true,
    term: recastTermNow,
    totalInterestLeft: round(totalInterest(recastPrincipal, m.rate, recastPI, recastTermNow)),
    note: 'Same rate, same payoff date, no closing costs, buydown survives. Cannot lower the '
      + 'rate — this is the move that does not depend on the market.',
    verify: 'UWM must offer a recast on this loan; most conventional servicers do, typically '
      + 'with a minimum principal reduction and a fee of a few hundred dollars.',
  });

  // ── Refinance at the buydown's end, at a range of rates ────────────────────
  const rates = cfg.rates ?? [0.06625, 0.0625, 0.06, 0.0575, 0.055, 0.05];
  for (const rate of rates) {
    for (const term of cfg.terms ?? [360, 300]) {
      const principalBefore = balanceAtBuydownEnd - cashIn;
      const costs = round(principalBefore * closingRate);
      const principal = round(principalBefore + (cfg.rollCosts === false ? 0 : costs));
      const pi = round(payment(principal, rate, term));
      const total = round(pi + escrowLater);
      const saving = round(doNothingLater - total);
      scenarios.push({
        key: `refi-${Math.round(rate * 10000)}-${term}`,
        label: `Refinance at ${(rate * 100).toFixed(3)}%`,
        when: buydownEnds === '2027-09' ? 'Sep 2027' : buydownEnds,
        rate,
        term,
        principal,
        pi,
        escrow: escrowLater,
        total,
        cashIn,
        cost: costs,
        rolledIn: cfg.rollCosts !== false,
        keepsBuydown: false,
        saving,
        breakEvenMonths: saving > 0 ? round(costs / saving, 1) : null,
        totalInterestLeft: round(totalInterest(principal, rate, pi, term)),
        isRefi: true,
      });
    }
  }

  // ── Recast now, then refinance later if rates move ─────────────────────────
  // The two are not alternatives. Recasting costs a few hundred dollars and
  // keeps the subsidy; refinancing a year later starts from the smaller balance
  // the recast left behind.
  const bestRate = Math.min(...rates);
  if (bestRate < m.rate) {
    const balAtEnd = round(balanceAfter(recastPrincipal, m.rate, recastPI, bd.months - paymentsMade));
    const costs = round(balAtEnd * closingRate);
    const principal = round(balAtEnd + costs);
    const pi = round(payment(principal, bestRate, 360));
    scenarios.push({
      key: 'recast-then-refi',
      label: `Recast now, refinance at ${(bestRate * 100).toFixed(3)}% later`,
      when: `Now, then ${buydownEnds}`,
      rate: bestRate,
      term: 360,
      principal,
      pi,
      escrow: escrowLater,
      total: round(pi + escrowLater),
      cashIn,
      cost: round(recastFee + costs),
      keepsBuydown: true,
      combined: true,
      totalInterestLeft: round(totalInterest(principal, bestRate, pi, 360)),
      note: 'Not an alternative to the others — a sequence. The recast collects the full '
        + 'subsidy and shrinks the balance; the refinance then starts from that smaller number '
        + 'and only happens if rates actually fall.',
    });
  }

  // Everything is judged against doing nothing, at the same moment, on the same
  // escrow.
  for (const s of scenarios) {
    const comparable = s.totalLater ?? s.total;
    s.comparable = comparable;
    s.savingVsNothing = round(doNothingLater - comparable);
    s.interestVsNothing = round(s.totalInterestLeft - scenarios[0].totalInterestLeft);
    if (s.cost > 0 && s.savingVsNothing > 0) {
      s.breakEvenMonths = round(s.cost / s.savingVsNothing, 1);
    }
  }
  scenarios.sort((a, b) => b.savingVsNothing - a.savingVsNothing);

  // ── Liquidity ─────────────────────────────────────────────────────────────
  // Putting cash into a house you are already running a deficit against trades
  // buffer for payment. Worth stating in months, not adjectives.
  const A = payload.affordability;
  const liquid = payload.headline.cashAvailable + payload.headline.cashOnHold;
  const burnNow = Math.max(1, -A.scenarios[0].netCash);
  const recastScenario = scenarios.find((s) => s.key === 'recast-now');
  const burnAfterRecast = Math.max(1, burnNow - (payingNow - recastScenario.total));

  const liquidity = {
    liquidNow: round(liquid),
    burnNow: round(burnNow),
    runwayNow: round(liquid / burnNow, 1),
    liquidAfter: round(liquid - cashIn),
    burnAfter: round(burnAfterRecast),
    runwayAfter: round((liquid - cashIn) / burnAfterRecast, 1),
    barclaysApy: (config.accounts.find((a) => a.apy) ?? {}).apy ?? null,
    interestForgone: round(cashIn * ((config.accounts.find((a) => a.apy) ?? {}).apy ?? 0)),
    interestAvoided: round(cashIn * m.rate),
  };
  liquidity.arbitrage = round(liquidity.interestAvoided - liquidity.interestForgone);

  return {
    cashIn,
    asOfMonth,
    paymentsMade,
    balanceNow,
    balanceAtBuydownEnd,
    buydownEnds,
    subsidyRemaining,
    subsidyTotal: bd.subsidyTotal,
    payingNow,
    doNothingLater,
    escrowNow,
    escrowLater,
    closingRate,
    scenarios,
    liquidity,
    // The two facts that make the timing question answerable.
    noPrepaymentPenalty: true,
    clause7: 'If the note is prepaid in full before the whole subsidy has been disbursed, the '
      + 'remainder goes back to the lender. A refinance is a prepayment in full; a partial '
      + 'prepayment and recast is not.',
  };
}
