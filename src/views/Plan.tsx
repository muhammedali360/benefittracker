import { useMemo } from 'react'
import type { useStore } from '../store'
import {
  compareProfiles,
  computeBonus,
  computePaycheck,
  PERIODS_PER_YEAR,
  type CompProfile,
} from '../engine/tax'
import { contributionHeadroom, deferralPacing } from '../engine/contributions'
import { getTaxYear } from '../engine/taxData'
import { money, percent } from '../format'
import { AllocationBar, type Segment } from '../charts'

type Store = ReturnType<typeof useStore>
type Section = 'raise' | 'bonus' | 'contributions'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'raise', label: 'Raise or move' },
  { id: 'bonus', label: 'Bonus' },
  { id: 'contributions', label: 'Contributions' },
]

const signed = (n: number, cents = false) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n), cents)}`

/**
 * `polarity` is which direction is *good*, not which is up. More take-home is
 * green; more tax is emphatically not, and colouring both by sign alone would
 * have every row of a raise read as a win.
 */
function Delta({
  value,
  polarity = 1,
  cents = false,
}: {
  value: number
  polarity?: 1 | -1 | 0
  cents?: boolean
}) {
  if (Math.abs(value) < 0.005) return <span className="delta">—</span>
  const tone = polarity === 0 ? '' : value * polarity > 0 ? 'up' : 'down'
  return <span className={`delta ${tone}`}>{signed(value, cents)}</span>
}

const isSection = (s: string | undefined): s is Section => SECTIONS.some((x) => x.id === s)

export function Plan({
  store,
  section: requested,
  onSection,
}: {
  store: Store
  section?: string
  onSection: (s: Section) => void
}) {
  const section: Section = isSection(requested) ? requested : 'raise'

  return (
    <>
      <div className="subtabs">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`action${section === s.id ? ' primary' : ''}`}
            onClick={() => onSection(s.id)}
            aria-pressed={section === s.id}
          >
            {s.label}
          </button>
        ))}
      </div>
      {section === 'raise' && <RaiseSection store={store} />}
      {section === 'bonus' && <BonusSection store={store} />}
      {section === 'contributions' && <ContributionsSection store={store} />}
    </>
  )
}

// --- raise / relocation ----------------------------------------------------

function RaiseSection({ store }: { store: Store }) {
  const { profile, scenarios } = store.state
  const taxYear = getTaxYear(profile.year)
  // Seeded with a 10% bump — a starting point that's obviously an example,
  // rather than a zero-delta screen that shows nothing until you type. Once
  // edited, the scenario is persisted so it survives a tab switch or reload.
  const seed = {
    annualSalary: Math.round((profile.annualSalary * 1.1) / 500) * 500,
    state: profile.state,
    retirement401kPercent: profile.retirement401kPercent,
  }
  const variant: CompProfile = { ...profile, ...(scenarios.raise ?? seed) }
  const setVariant = (next: CompProfile) =>
    store.setScenarios({
      raise: {
        annualSalary: next.annualSalary,
        state: next.state,
        retirement401kPercent: next.retirement401kPercent,
      },
    })

  const d = useMemo(() => compareProfiles(profile, variant), [profile, variant])
  const periods = PERIODS_PER_YEAR[profile.payFrequency]
  const movedState = variant.state !== profile.state

  return (
    <>
      <div className="card">
        <h2>What would actually change</h2>
        <p className="caption">
          A raise, a move, a different 401(k) rate — all the same question. Edit the right-hand
          column; nothing here touches your saved profile.
          {scenarios.raise && (
            <>
              {' '}
              <button
                type="button"
                className="action link"
                onClick={() => store.setScenarios({ raise: null })}
              >
                Reset to a 10% raise
              </button>
            </>
          )}
        </p>

        <div className="compare-grid">
          <div className="compare-col">
            <h3>Today</h3>
            <div className="field-grid" style={{ gridTemplateColumns: '1fr' }}>
              <label className="field">
                Annual salary
                <input type="number" value={profile.annualSalary} disabled />
              </label>
              <label className="field">
                State
                <input value={taxYear.states[profile.state]?.name ?? profile.state} disabled />
              </label>
              <label className="field">
                401(k) rate
                <input value={percent(profile.retirement401kPercent)} disabled />
              </label>
            </div>
          </div>

          <div className="compare-col">
            <h3>Scenario</h3>
            <div className="field-grid" style={{ gridTemplateColumns: '1fr' }}>
              <label className="field">
                Annual salary
                <input
                  type="number"
                  step="1000"
                  value={variant.annualSalary}
                  onChange={(e) => setVariant({ ...variant, annualSalary: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                State
                <select
                  value={variant.state}
                  onChange={(e) => setVariant({ ...variant, state: e.target.value })}
                >
                  {Object.entries(taxYear.states).map(([code, s]) => (
                    <option key={code} value={code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                401(k) rate
                <input
                  type="number"
                  step="0.5"
                  value={Math.round(variant.retirement401kPercent * 1000) / 10}
                  onChange={(e) =>
                    setVariant({ ...variant, retirement401kPercent: Number(e.target.value) / 100 })
                  }
                />
                <span className="hint">% of gross</span>
              </label>
            </div>
          </div>
        </div>

        <div className="verdict">
          {d.grossDelta !== 0 ? (
            <>
              <div className="big">
                <span className={d.netDelta >= 0 ? 'delta up' : 'delta down'}>
                  {signed(d.netDelta)}
                </span>{' '}
                take-home per year
              </div>
              <p className="qualifier">
                Of the {signed(d.grossDelta)} change in gross you keep{' '}
                <strong>{percent(Math.abs(d.keepRate))}</strong> — {signed(d.netDelta / periods, true)}{' '}
                per paycheck. Tax takes {money(Math.abs(d.taxDelta))} of it.
                {d.matchDelta !== 0 && (
                  <> Employer match changes by {signed(d.matchDelta)} on top.</>
                )}
              </p>
            </>
          ) : (
            <>
              <div className="big">
                <span className={d.netDelta >= 0 ? 'delta up' : 'delta down'}>
                  {signed(d.netDelta)}
                </span>{' '}
                take-home per year
              </div>
              <p className="qualifier">
                Same salary, {movedState ? 'different state' : 'different elections'} —{' '}
                {signed(d.netDelta / periods, true)} per paycheck.
                {d.matchDelta !== 0 && (
                  <> Employer match changes by {signed(d.matchDelta)}, so the total value received
                    moves {signed(d.totalValueDelta)}.</>
                )}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Side by side</h2>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Today</th>
                <th className="num">Scenario</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Gross salary', d.base.gross, d.variant.gross, 1],
                  ['Federal income tax', d.base.federalIncomeTax, d.variant.federalIncomeTax, -1],
                  ['State income tax', d.base.stateIncomeTax, d.variant.stateIncomeTax, -1],
                  [
                    'FICA & disability',
                    d.base.socialSecurity + d.base.medicare + d.base.additionalMedicare + d.base.disabilityInsurance,
                    d.variant.socialSecurity + d.variant.medicare + d.variant.additionalMedicare + d.variant.disabilityInsurance,
                    -1,
                  ],
                  // Deferring more cuts take-home but isn't a loss — it's yours.
                  ['Pre-tax deductions', d.base.ficaExemptPretax + d.base.retirement, d.variant.ficaExemptPretax + d.variant.retirement, 0],
                  ['Effective tax rate', d.base.effectiveRate, d.variant.effectiveRate, -1],
                  ['Employer match', d.base.employerMatch, d.variant.employerMatch, 1],
                  ['Take-home', d.base.net, d.variant.net, 1],
                ] as [string, number, number, 1 | -1 | 0][]
              ).map(([label, a, b, polarity]) => {
                const isRate = label.includes('rate')
                return (
                  <tr key={label} className={label === 'Take-home' ? 'total' : undefined}>
                    <td className="name">{label}</td>
                    <td className="num">{isRate ? percent(a) : money(a)}</td>
                    <td className="num">{isRate ? percent(b) : money(b)}</td>
                    <td className="num">
                      {isRate ? (
                        <span className={`delta ${b > a ? 'down' : b < a ? 'up' : ''}`}>
                          {b === a ? '—' : `${b > a ? '+' : '−'}${percent(Math.abs(b - a))}`}
                        </span>
                      ) : (
                        <Delta value={b - a} polarity={polarity} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted-note" style={{ marginTop: 12 }}>
          {movedState
            ? 'A state move changes withholding only. Cost of living, and any city tax, are not modelled.'
            : 'Both columns use the same tax year and the same pre-tax elections unless you changed them.'}
        </p>
      </div>
    </>
  )
}

// --- bonus -----------------------------------------------------------------

function BonusSection({ store }: { store: Store }) {
  const { profile, scenarios } = store.state
  const taxYear = getTaxYear(profile.year)
  const { gross, deferPct } = scenarios.bonus
  const setGross = (v: number) => store.setScenarios({ bonus: { gross: v, deferPct } })
  const setDeferPct = (v: number) => store.setScenarios({ bonus: { gross, deferPct: v } })

  const b = useMemo(
    () => computeBonus(profile, gross, taxYear, deferPct / 100),
    [profile, gross, deferPct, taxYear],
  )

  const segments: Segment[] = [
    { label: 'Lands in your account', value: b.net, color: 'var(--series-net)' },
    ...(b.retirement ? [{ label: 'To 401(k)', value: b.retirement, color: 'var(--series-pretax)' }] : []),
    {
      label: 'FICA & SDI',
      value: b.socialSecurity + b.medicare + b.additionalMedicare + b.disability,
      color: 'var(--series-fica)',
    },
    { label: 'Federal withholding', value: b.federalWithheld, color: 'var(--series-federal)' },
    ...(b.stateWithheld ? [{ label: 'State withholding', value: b.stateWithheld, color: 'var(--series-state)' }] : []),
  ]

  return (
    <>
      <div className="card">
        <h2>What a bonus actually pays</h2>
        <p className="caption">
          Bonuses are withheld at a flat supplemental rate, not at your bracket. The two are rarely
          the same number.
        </p>
        <div className="field-grid">
          <label className="field">
            Bonus amount
            <input
              type="number"
              step="1000"
              value={gross || ''}
              placeholder="10000"
              onChange={(e) => setGross(Number(e.target.value))}
            />
          </label>
          <label className="field">
            Defer to 401(k)
            <input
              type="number"
              step="5"
              min="0"
              max="100"
              value={deferPct || ''}
              placeholder="0"
              onChange={(e) => setDeferPct(Number(e.target.value))}
            />
            <span className="hint">% of the bonus, if your plan allows it</span>
          </label>
        </div>

        {gross > 0 && (
          <div className="verdict">
            <div className="big">{money(b.net)}</div>
            <p className="qualifier">
              hits your account — {percent(b.keepRate)} of {money(b.gross)}.
              {b.retirement > 0 && <> A further {money(b.retirement)} goes to your 401(k).</>}
            </p>
          </div>
        )}
      </div>

      {gross > 0 && (
        <>
          <div className="card">
            <h2>Where the bonus goes</h2>
            <p className="caption">Hover a segment for detail.</p>
            <AllocationBar segments={segments} total={b.gross} />
          </div>

          {Math.abs(b.withholdingGap) > 50 && (
            <div className={`callout ${b.withholdingGap < 0 ? 'critical' : 'good'}`}>
              <span className="icon" aria-hidden="true">
                {b.withholdingGap < 0 ? '⚠' : '↩'}
              </span>
              <span>
                {b.withholdingGap < 0 ? (
                  <>
                    <strong>
                      This bonus is under-withheld by about {money(-b.withholdingGap)}.
                    </strong>{' '}
                    Your employer withholds{' '}
                    {percent(taxYear.federal.supplemental.rate, 0)} federal on supplemental wages,
                    but stacked on your income the bonus really costs{' '}
                    {money(b.trueIncomeTax)} in income tax. The difference isn't forgiven — it shows
                    up as a smaller refund or a bill in April. Set it aside now.
                  </>
                ) : (
                  <>
                    <strong>This bonus is over-withheld by about {money(b.withholdingGap)}.</strong>{' '}
                    The flat {percent(taxYear.federal.supplemental.rate, 0)} federal supplemental
                    rate is above your bracket, so you're lending the difference to the Treasury
                    until you file. You'll get it back — just not until then.
                  </>
                )}
              </span>
            </div>
          )}

          <div className="card">
            <h2>Line by line</h2>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Amount</th>
                    <th className="num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['Bonus', b.gross],
                      ...(b.retirement ? ([['401(k) deferral', -b.retirement]] as [string, number][]) : []),
                      ['Federal withholding (flat)', -b.federalWithheld],
                      ...(b.stateWithheld ? ([['State withholding (flat)', -b.stateWithheld]] as [string, number][]) : []),
                      ...(b.socialSecurity ? ([['Social Security', -b.socialSecurity]] as [string, number][]) : []),
                      ['Medicare', -b.medicare],
                      ...(b.additionalMedicare ? ([['Additional Medicare', -b.additionalMedicare]] as [string, number][]) : []),
                      ...(b.disability ? ([[taxYear.states[profile.state]?.disabilityInsurance?.label ?? 'Disability', -b.disability]] as [string, number][]) : []),
                      ['Net', b.net],
                    ] as [string, number][]
                  ).map(([label, v]) => (
                    <tr key={label} className={label === 'Net' ? 'total' : undefined}>
                      <td className="name">{label}</td>
                      <td className="num">{money(v, true)}</td>
                      <td className="num">{percent(Math.abs(v) / b.gross)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted-note" style={{ marginTop: 12 }}>
              Withholding is what your employer takes out. What the bonus finally costs is{' '}
              {money(b.trueIncomeTax)} of income tax plus{' '}
              {money(b.socialSecurity + b.medicare + b.additionalMedicare + b.disability)} of FICA —
              the FICA part is final, the income-tax part reconciles when you file.
            </p>
          </div>
        </>
      )}
    </>
  )
}

// --- contributions ---------------------------------------------------------

function ContributionsSection({ store }: { store: Store }) {
  const { profile } = store.state
  const taxYear = getTaxYear(profile.year)
  const family = store.state.scenarios.familyHsa
  const setFamily = (v: boolean) => store.setScenarios({ familyHsa: v })

  const pacing = useMemo(() => deferralPacing(profile, taxYear), [profile, taxYear])
  const rooms = useMemo(
    () => contributionHeadroom(profile, taxYear, family),
    [profile, taxYear, family],
  )
  const run = useMemo(() => computePaycheck(profile, taxYear), [profile, taxYear])
  const idealPct = Math.round(pacing.idealPercent * 1000) / 10

  return (
    <>
      <div className="card">
        <h2>Your 401(k) rate</h2>
        <p className="caption">
          The right rate spends the annual limit on the last paycheck of the year — not in October,
          when the match stops with it.
        </p>

        <div className="meter">
          <span
            style={{
              width: `${Math.min(100, (pacing.elected / pacing.limit) * 100)}%`,
              // Front-loading is the failure mode, so it reads as a warning.
              ['--fill' as string]:
                pacing.status === 'front-loaded' ? 'var(--critical)' : 'var(--series-pretax)',
            }}
          />
        </div>
        <p className="muted-note">
          {/* Above the limit, "$52,500 of the $24,500 limit" is nonsense — the
              election overshoots, it doesn't overfill. */}
          {pacing.elected > pacing.limit ? (
            <>
              {percent(profile.retirement401kPercent)} would defer {money(pacing.elected)} a year,
              but the limit is {money(pacing.limit)} · deferrals stop at paycheck{' '}
              {pacing.limitPeriod} of {pacing.periodsPerYear}
            </>
          ) : (
            <>
              {money(pacing.elected)} of the {money(pacing.limit)} limit at{' '}
              {percent(profile.retirement401kPercent)} · reaches it at paycheck{' '}
              {pacing.limitPeriod} of {pacing.periodsPerYear}
            </>
          )}
        </p>

        <div className="verdict">
          {pacing.status === 'front-loaded' ? (
            <>
              <div className="big">Set it to {idealPct}%</div>
              <p className="qualifier">
                At {percent(profile.retirement401kPercent)} you hit the limit at paycheck{' '}
                {pacing.limitPeriod}, and every paycheck after that defers nothing — so it earns no
                match.
                {pacing.forfeitedMatch > 0 && (
                  <>
                    {' '}
                    That's <strong>{money(pacing.forfeitedMatch)}</strong> of employer money left on
                    the table, unless your plan trues up at year end.
                  </>
                )}{' '}
                {idealPct}% contributes the same {money(pacing.limit)} spread across all{' '}
                {pacing.periodsPerYear} checks.
              </p>
            </>
          ) : pacing.status === 'on-target' ? (
            <>
              <div className="big">
                <span className="delta up">On target</span>
              </div>
              <p className="qualifier">
                {percent(profile.retirement401kPercent)} spends the {money(pacing.limit)} limit
                across the whole year. Nothing to change.
              </p>
            </>
          ) : (
            <>
              <div className="big">{idealPct}% would max it</div>
              <p className="qualifier">
                {pacing.status === 'none'
                  ? `You're not contributing. `
                  : `At ${percent(profile.retirement401kPercent)} you'll finish the year ${money(pacing.limit - pacing.elected)} under the limit. `}
                {idealPct >= 100
                  ? 'Your salary is below the limit, so even 100% would not reach it.'
                  : `Contributing ${idealPct}% of gross reaches ${money(pacing.limit)} exactly on the last paycheck.`}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>What the room left over would cost</h2>
        <p className="caption">
          Unused headroom priced in take-home rather than in gross — which is the number that
          decides it. Your marginal rate is {percent(run.marginalRate)}.
        </p>
        <div className="row" style={{ marginBottom: 14 }}>
          <button
            className={`action${family ? ' primary' : ''}`}
            onClick={() => setFamily(!family)}
            aria-pressed={family}
          >
            Family HSA coverage
          </button>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Elected</th>
                <th className="num">{profile.year} limit</th>
                <th className="num">Room left</th>
                <th className="num">Per paycheck</th>
                <th className="num">Real cost</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.key}>
                  <td className="name">
                    {r.label}
                    {r.ficaExempt && (
                      <span className="pill" style={{ marginLeft: 8 }}>
                        dodges FICA too
                      </span>
                    )}
                  </td>
                  <td className="num">{money(r.elected)}</td>
                  <td className="num">{money(r.limit)}</td>
                  <td className="num">{r.headroom > 0 ? money(r.headroom) : '—'}</td>
                  <td className="num">{r.headroom > 0 ? money(r.perPeriodToMax, true) : '—'}</td>
                  <td className="num">
                    {r.headroom > 0 ? (
                      <>
                        {money(r.netCost)}{' '}
                        <span className="delta up" style={{ fontWeight: 400 }}>
                          (saves {money(r.taxSaved)})
                        </span>
                      </>
                    ) : (
                      <span className="delta up">maxed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted-note" style={{ marginTop: 12 }}>
          "Real cost" is the headroom minus the tax it avoids at your marginal rate. HSA and FSA
          dollars escape FICA as well as income tax, so they're the cheapest of the three — but FSA
          money is use-it-or-lose-it, and HSA eligibility requires a high-deductible plan.
          Contributing enough to drop a bracket would make these savings slightly optimistic.
        </p>
      </div>
    </>
  )
}
