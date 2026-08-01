import { useMemo, useState } from 'react'
import type { CompProfile } from '../engine/tax'
import { computePaycheck, socialSecurityCutoff, matchForfeitureRisk } from '../engine/tax'
import { getTaxYear } from '../engine/taxData'
import { payTimeline, summariseTimeline } from '../engine/timeline'
import { AllocationBar, PaycheckTimeline, type Segment } from '../charts'
import { money, percent, prettyDate } from '../format'

type Lens = 'period' | 'monthly' | 'annual'

const LENSES: { id: Lens; label: string }[] = [
  { id: 'period', label: 'Per paycheck' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'annual', label: 'Annual' },
]

export function Paycheck({ profile }: { profile: CompProfile }) {
  const [lens, setLens] = useState<Lens>('period')
  const r = useMemo(() => computePaycheck(profile), [profile])
  const taxYear = getTaxYear(profile.year)
  const ssCutoff = useMemo(() => socialSecurityCutoff(profile), [profile])
  const match = useMemo(() => matchForfeitureRisk(profile), [profile])
  const timeline = useMemo(() => summariseTimeline(payTimeline(profile)), [profile])

  // Same annual figures, three lenses — never recomputed, just divided.
  const scale = lens === 'annual' ? 1 : lens === 'monthly' ? 12 : r.periodsPerYear
  const at = (annual: number) => annual / scale

  const fica = r.socialSecurity + r.medicare + r.additionalMedicare + r.disabilityInsurance
  const segments: Segment[] = [
    { label: 'Take-home', value: r.net, color: 'var(--series-net)' },
    { label: 'Pre-tax benefits', value: r.ficaExemptPretax + r.retirement, color: 'var(--series-pretax)' },
    { label: 'FICA & SDI', value: fica, color: 'var(--series-fica)' },
    { label: 'Federal income tax', value: r.federalIncomeTax, color: 'var(--series-federal)' },
    { label: 'State income tax', value: r.stateIncomeTax, color: 'var(--series-state)' },
  ]

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="label">Take-home {lens === 'annual' ? 'per year' : lens === 'monthly' ? 'per month' : 'per paycheck'}</div>
          <div className="value">{money(at(r.net))}</div>
          <div className="note">of {money(at(r.gross))} gross</div>
        </div>
        <div className="tile">
          <div className="label">Effective tax rate</div>
          <div className="value">{percent(r.effectiveRate)}</div>
          <div className="note">{money(r.totalTax)} of tax per year</div>
        </div>
        <div className="tile">
          <div className="label">Marginal rate</div>
          <div className="value">{percent(r.marginalRate)}</div>
          <div className="note">what your next dollar is taxed at</div>
        </div>
        <div className="tile">
          <div className="label">Employer match</div>
          <div className="value">{money(at(r.employerMatch))}</div>
          <div className="note">free money on top of gross</div>
        </div>
      </div>

      {timeline.periods.length > 0 && (
        <div className="card">
          <h2>Every paycheck this year</h2>
          <p className="caption">
            {timeline.spread > 1 ? (
              <>
                Your checks are not all the same. The smallest is{' '}
                {money(timeline.smallest!.net, true)} and the largest{' '}
                {money(timeline.largest!.net, true)} — a {money(timeline.spread, true)} swing, driven
                by the wage-base and contribution limits below.
              </>
            ) : (
              <>
                Every check this year lands at {money(timeline.largest!.net, true)}. Nothing crosses
                a wage base or a contribution limit, so nothing steps.
              </>
            )}
          </p>
          <PaycheckTimeline points={timeline.periods} />
        </div>
      )}

      <div className="card">
        <h2>Where your gross pay goes</h2>
        <p className="caption">
          {money(r.gross)} gross per year, split five ways. Hover a segment for detail.
        </p>
        <AllocationBar segments={segments} total={r.gross} />
      </div>

      {ssCutoff && (
        <div className="callout good">
          <span className="icon" aria-hidden="true">
            ↑
          </span>
          <span>
            <strong>Your paychecks get bigger around {prettyDate(ssCutoff.date)}.</strong> You
            cross the {money(taxYear.federal.socialSecurity.wageBase)} Social Security wage base
            at paycheck {ssCutoff.periodIndex}, after which the 6.2% stops for the rest of the
            year. Medicare and CA SDI keep going — SDI has no cap at all.
          </span>
        </div>
      )}

      {match.hitsLimitEarly && (
        <div className="callout critical">
          <span className="icon" aria-hidden="true">
            ⚠
          </span>
          <span>
            <strong>You may be forfeiting {money(match.forfeitedMatch)} of employer match.</strong>{' '}
            At this contribution rate you hit the {money(taxYear.limits.elective401k)} annual limit
            at paycheck {match.limitPeriod} of {r.periodsPerYear}. Every paycheck after that
            contributes $0, so it earns $0 of match — unless your plan has a true-up. Lower the
            rate to spread contributions across the whole year, or confirm the true-up exists.
          </span>
        </div>
      )}

      <div className="card">
        <h2>Line by line</h2>
        <div className="row" style={{ marginBottom: 14 }}>
          {LENSES.map((l) => (
            <button
              key={l.id}
              className={`action${lens === l.id ? ' primary' : ''}`}
              onClick={() => setLens(l.id)}
              aria-pressed={lens === l.id}
            >
              {l.label}
            </button>
          ))}
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">
                {lens === 'annual' ? 'Per year' : lens === 'monthly' ? 'Per month' : 'Per paycheck'}
              </th>
              <th className="num">Per year</th>
            </tr>
          </thead>
          <tbody>
            {r.lineItems.map((li) => (
              <tr key={li.label} className={li.kind === 'net' ? 'total' : undefined}>
                <td className="name">{li.label}</td>
                <td className="num">{money(at(li.annual), true)}</td>
                <td className="num">{money(li.annual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted-note" style={{ marginTop: 12 }}>
          A projection from your salary and elections, not a copy of your paystub. Real checks
          drift with mid-year premium changes, bonuses and imputed income.
        </p>
      </div>
    </>
  )
}
