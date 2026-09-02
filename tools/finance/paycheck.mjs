/**
 * Paycheck model.
 *
 * The bank ledger only ever sees net pay, which hides a large part of the
 * household's actual saving: the ASRS pension, both 403(b)s and the HSA all come
 * out before the deposit lands, and the employer match never touches an account
 * anyone can see. Measured on bank transfers alone, this household looks like it
 * saves ~26% of take-home. Counting payroll deductions, it saves far more.
 *
 * The withholding projection here is arithmetic over stated assumptions, not tax
 * advice — every input is surfaced in the UI so it can be checked or overridden.
 */

const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

const sumBy = (rows, pred) => rows.reduce((s, r) => (pred(r) ? s + r.amount : s), 0);

export function paycheckModel(config) {
  const periods = config.income.periodsPerYear ?? 26;

  const earners = config.income.earners.map((e) => {
    const d = e.deductions;
    const retirement = sumBy(d, (x) => x.kind === 'retirement');
    const hsa = sumBy(d, (x) => x.kind === 'hsa');
    // Dependent care is pre-tax but it is prepaid childcare, not saving — and it
    // is an annual election spread over fewer periods than the year has, so it
    // never annualises by simple multiplication.
    const dependentCare = sumBy(d, (x) => x.kind === 'dependentcare');
    const dependentCareAnnual = d
      .filter((x) => x.kind === 'dependentcare')
      .reduce((s2, x) => s2 + (x.annualCap ?? x.amount * periods), 0);
    const tax = sumBy(d, (x) => x.kind === 'tax');
    const insurance = sumBy(d, (x) => x.kind === 'insurance');
    const preTaxPerPeriod = sumBy(d, (x) => x.preTax && x.kind !== 'dependentcare');
    const preTaxAnnual = preTaxPerPeriod * periods + dependentCareAnnual;
    const employerPaid = e.employerPaid.reduce((s, x) => s + x.amount, 0);
    const employerRetirement = e.employerPaid
      .filter((x) => /ASRS|pension|match/i.test(x.name))
      .reduce((s, x) => s + x.amount, 0);

    return {
      ...e,
      periods,
      annualGross: round(e.gross * periods),
      annualNet: round(e.net * periods),
      retirement: round(retirement),
      hsa: round(hsa),
      dependentCare: round(dependentCare),
      dependentCareAnnual: round(dependentCareAnnual),
      tax: round(tax),
      insurance: round(insurance),
      preTaxAnnual: round(preTaxAnnual),
      employerPaid: e.employerPaid,
      employerPaidTotal: round(employerPaid),
      employerRetirement: round(employerRetirement),
      federalPerPeriod: round(sumBy(d, (x) => /federal/i.test(x.name))),
      statePerPeriod: round(sumBy(d, (x) => /arizona|state tax/i.test(x.name))),
    };
  });

  const t = (k) => round(earners.reduce((s, e) => s + e[k], 0));
  const household = {
    periods,
    grossPerPeriod: t('gross'),
    netPerPeriod: t('net'),
    annualGross: t('annualGross'),
    annualNet: t('annualNet'),
    monthlyNet: round(t('annualNet') / 12),
    monthlyGross: round(t('annualGross') / 12),

    // What actually gets saved, including everything the bank never sees.
    retirementPerPeriod: t('retirement'),
    hsaPerPeriod: t('hsa'),
    dependentCarePerPeriod: t('dependentCare'),
    employerRetirementPerPeriod: t('employerRetirement'),
    annualRetirement: round(t('retirement') * periods),
    annualHsa: round(t('hsa') * periods),
    annualDependentCare: t('dependentCareAnnual'),
    annualEmployerRetirement: round(t('employerRetirement') * periods),
    annualEmployerBenefits: round(t('employerPaidTotal') * periods),

    taxPerPeriod: t('tax'),
    insurancePerPeriod: t('insurance'),
    annualPreTax: t('preTaxAnnual'),
    federalWithheldAnnual: round(t('federalPerPeriod') * periods),
    stateWithheldAnnual: round(t('statePerPeriod') * periods),
  };

  household.totalComp = round(household.annualGross + household.annualEmployerBenefits);
  household.trueSavingsAnnual = round(
    household.annualRetirement + household.annualEmployerRetirement + household.annualHsa,
  );
  household.trueSavingsRateOfGross = round(
    (household.trueSavingsAnnual / household.annualGross) * 100, 1,
  );

  return { earners, household, tax: taxProjection(config, household) };
}

/**
 * Rough federal and Arizona liability against what is actually being withheld.
 * Deliberately transparent: every step is returned so the UI can show the
 * working rather than asserting a number.
 */
function taxProjection(config, hh) {
  const a = config.taxAssumptions;
  if (!a) return null;

  const federalWages = round(hh.annualGross - hh.annualPreTax);
  const taxableIncome = Math.max(0, round(federalWages - a.standardDeduction));

  let tax = 0;
  let prev = 0;
  const bands = [];
  for (const [ceiling, rate] of a.brackets) {
    if (taxableIncome <= prev) break;
    const inBand = Math.min(taxableIncome, ceiling) - prev;
    if (inBand > 0) {
      tax += inBand * rate;
      bands.push({ rate, amount: round(inBand), tax: round(inBand * rate) });
    }
    prev = ceiling;
  }

  const credits = a.dependentChildren * a.childTaxCredit;
  const federalOnWages = Math.max(0, round(tax - credits));

  const cg = a.capitalGainsAssumption;
  const assumedGain = cg ? round(cg.proceeds * cg.assumedGainShare) : 0;
  const federalOnGains = cg ? round(assumedGain * cg.ltcgRate) : 0;
  const stateOnGains = cg ? round(assumedGain * a.azFlatRate) : 0;

  const stateLiability = round(taxableIncome * a.azFlatRate);

  return {
    assumptions: a,
    federalWages,
    taxableIncome,
    bands,
    grossFederalTax: round(tax),
    credits: round(credits),
    federalOnWages,
    federalWithheld: hh.federalWithheldAnnual,
    federalGapOnWages: round(federalOnWages - hh.federalWithheldAnnual),

    assumedGain,
    federalOnGains,
    stateOnGains,

    stateLiability,
    stateWithheld: hh.stateWithheldAnnual,
    stateGap: round(stateLiability + stateOnGains - hh.stateWithheldAnnual),

    totalGap: round(
      (federalOnWages - hh.federalWithheldAnnual) + federalOnGains
      + (stateLiability + stateOnGains - hh.stateWithheldAnnual),
    ),
  };
}
