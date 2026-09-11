import { useMemo, useState } from 'react'
import type { CompProfile } from '../engine/tax'
import { computePaycheck, socialSecurityCutoff, matchForfeitureRisk } from '../engine/tax'
import { getTaxYear } from '../engine/taxData'
import { payTimeline, summariseTimeline } from '../engine/timeline'
import { AllocationBar, PaycheckTimeline, type Segment } from '../charts'
import { money, percent, prettyDate } from '../format'

type Lens = 'period' | 'monthly' | 'annual'

const LENSES: { id: Lens; label: string; unit: string }[] = [
  { id: 'period', label: 'Per paycheck', unit: 'per paycheck' },
  { id: 'monthly', label: 'Monthly', unit: 'per month' },
  { id: 'annual', label: 'Annual', unit: 'per year' },
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
  const unit = LENSES.find((l) => l.id === lens)!.unit

  const fica = r.socialSecurity + r.medicare + r.additionalMedicare + r.disabilityInsurance
  const pretax = r.ficaExemptPretax + r.retirement
  const segments: Segment[] = [
    { label: 'Take-home', value: r.net, color: 'var(--series-net)' },
    { label: 'Pre-tax benefits', value: pretax, color: 'var(--series-pretax)' },
    { label: 'FICA & SDI', value: fica, color: 'var(--series-fica)' },
    { label: 'Federal income tax', value: r.federalIncomeTax, color: 'var(--series-federal)' },
    { label: 'State income tax', value: r.stateIncomeTax, color: 'var(--series-state)' },
  ]

  // The chart already knows the real pay date of every check; use it so the
  // callout and the step on the chart agree to the day.
  const ssDate = ssCutoff
    ? timeline.periods[ssCutoff.periodIndex - 1]?.date ?? ssCutoff.date
    : null

  return (
    <>
      {/* The lens drives the tiles and the table alike, so it sits above both. */}
      <div className="subtabs" role="group" aria-label="Time lens">
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

      <div className="tiles">
        <div className="tile">
          <div className="label">Take-home {unit}</div>
          <div className="value">{money(at(r.net))}</div>
          <div className="note">of {money(at(r.gross))} gross</div>
        </div>
        <div className="tile">
          <div className="label">Effective tax rate</div>
          <div className="value">{percent(r.effectiveRate)}</div>
          <div className="note">{money(at(r.totalTax))} of tax {unit}</div>
        </div>
        <div className="tile">
          <div className="label">Marginal rate</div>
          <div className="value">{percent(r.marginalRate)}</div>
          <div className="note">what your next dollar is taxed at</div>
        </div>
        {r.employerMatch > 0 ? (
          <div className="tile">
            <div className="label">Employer match</div>
            <div className="value">{money(at(r.employerMatch))}</div>
            <div className="note">free money on top of gross</div>
          </div>
        ) : (
          // No match configured: "$0 of free money" is noise. Show what's
          // being sheltered pre-tax instead, which is the other lever.
          <div className="tile">
            <div className="label">Pre-tax deductions</div>
            <div className="value">{pretax > 0 ? money(at(pretax)) : '—'}</div>
            <div className="note">
              {pretax > 0 ? 'sheltered from income tax' : 'none elected · add them in Settings'}
            </div>
          </div>
        )}
      </div>

      {/* A flat year is one sentence, not a chart of a horizontal line. */}
      {timeline.periods.length > 0 && timeline.spread > 1 ? (
        <div className="card">
          <h2>Every paycheck this year</h2>
          <p className="caption">
            Your checks are not all the same. The smallest is{' '}
            {money(timeline.smallest!.net, true)} and the largest{' '}
            {money(timeline.largest!.net, true)} — a {money(timeline.spread, true)} swing, driven by
            the wage-base and contribution limits below.
          </p>
          <PaycheckTimeline points={timeline.periods} />
        </div>
      ) : timeline.periods.length > 0 ? (
        <div className="callout">
          <span className="icon" aria-hidden="true">
            =
          </span>
          <span>
            <strong>Every check this year lands at {money(timeline.largest!.net, true)}.</strong>{' '}
            Nothing crosses a wage base or a contribution limit, so nothing steps.
          </span>
        </div>
      ) : null}

      <div className="card">
        <h2>Where your gross pay goes</h2>
        <p className="caption">
          {money(r.gross)} gross per year, split five ways. Hover a segment for detail.
        </p>
        <AllocationBar segments={segments} total={r.gross} />
      </div>

      {ssCutoff && ssDate && (
        <div className="callout good">
          <span className="icon" aria-hidden="true">
            ↑
          </span>
          <span>
            <strong>Your paychecks get bigger from {prettyDate(ssDate)}.</strong> You cross the{' '}
            {money(taxYear.federal.socialSecurity.wageBase)} Social Security wage base on paycheck{' '}
            {ssCutoff.periodIndex}, after which the 6.2% stops for the rest of the year. Medicare
            and CA SDI keep going — SDI has no cap at all.
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
        <p className="caption">
          {lens === 'annual'
            ? 'Annual figures.'
            : `Each line ${unit}, with the annual figure alongside.`}
        </p>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                {lens !== 'annual' && <th className="num">{unit[0].toUpperCase() + unit.slice(1)}</th>}
                <th className="num">Per year</th>
              </tr>
            </thead>
            <tbody>
              {r.lineItems.map((li) => (
                <tr key={li.label} className={li.kind === 'net' ? 'total' : undefined}>
                  <td className="name">{li.label}</td>
                  {lens !== 'annual' && <td className="num">{money(at(li.annual), true)}</td>}
                  <td className="num">{money(li.annual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted-note" style={{ marginTop: 12 }}>
          A projection from your salary and elections, not a copy of your paystub. Real checks
          drift with mid-year premium changes, bonuses and imputed income.
        </p>
      </div>
    </>
  )
}
