# Benefit Tracker

A personal compensation dashboard: what your paycheck actually becomes after
tax, and what time off you've banked — in days *and* in dollars.

Runs entirely on your machine. State lives in `localStorage`; there is no
backend, no account, and no network request. Paystub data shouldn't leave your
laptop.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine test suite
```

## What it does

**Paycheck** — splits gross pay five ways (take-home, pre-tax benefits, FICA &
SDI, federal, state) with per-paycheck / monthly / annual lenses. It also
surfaces two things payroll portals never tell you:

- the date your paychecks get *bigger* because you crossed the Social Security
  wage base, and
- whether your 401(k) rate front-loads hard enough to forfeit employer match
  (contributing $0 in December earns $0 of match, absent a plan true-up).

It also charts the year paycheck by paycheck, because an average check is only
the right answer if every check is the same — and once you cross the wage base
or hit the deferral limit, they aren't.

**Plan** — the three questions the paycheck view can't answer:

- *Raise or move.* What a salary bump, a state relocation or a different 401(k)
  rate does to take-home, side by side. The headline is the keep rate: of the
  extra gross, what actually survives.
- *Bonus.* Bonuses are **withheld** at a flat supplemental rate (22% federal,
  10.23% in California), not taxed at one. The app shows what lands in your
  account *and* what the bonus really costs at your bracket, because the gap
  between the two is either an April bill or an interest-free loan to the
  Treasury.
- *Contributions.* Diagnosis without a prescription is a dead end, so this
  solves for the deferral rate that spends the annual limit on the last
  paycheck rather than in October — and prices unused HSA/FSA/401(k) headroom
  in take-home instead of in gross. $3,200 of HSA room costs about $2,000.

**Time Off** — PTO and floating holidays in one view, because "how many days can
I take?" is a single number. The headline total sums every bucket, with a
per-bucket breakdown underneath, one chart with a line per bucket, and one
ledger spanning them all.

Underneath it's an append-only ledger. Balances are never stored; they're
replayed from typed events, so accrual-rate corrections apply retroactively and
floating holidays, comp days and manual adjustments are ordinary events rather
than special cases. Handles accrual ceilings, carryover caps, and negative
balances. Buckets keep their own workday length, so days are summed per bucket
rather than derived from total hours.

The projection is the point: not "what's my balance" but "what will it be in
November, and am I about to forfeit days on Dec 31." Forfeiture is quoted in
dollars, because that's what it is. On top of that:

- **When can I take a week off?** The earliest date the whole request is
  covered, counting time already booked — which is the question people actually
  ask.
- **Long weekends worth taking.** US federal holidays are computed from statute
  (observed-date rules included), and the runs of consecutive days off you can
  build around them are ranked by days-off-per-PTO-day. One day around
  Thanksgiving buys four; two around Veterans Day buys five. Plans you won't
  have the balance for by then are marked, not hidden.
- **Holiday-aware booking.** A week containing Thanksgiving costs four days,
  not five. Charging five is how a tracker invents a day you don't have.
- **A year calendar** showing everything booked and every holiday you don't
  need to spend a day on.

## Layout

```
src/engine/taxData.ts       year-keyed tax parameters (data, with sources)
src/engine/tax.ts           paycheck, bonus and scenario math — pure functions
src/engine/payDates.ts      the real pay dates of a year, shared by tax and timeline
src/engine/timeline.ts      the year replayed paycheck by paycheck
src/engine/contributions.ts deferral pacing and pre-tax headroom
src/engine/pto.ts           the PTO ledger — pure functions
src/engine/holidays.ts      US federal holidays, computed
src/engine/bridge.ts        bridge-day / long-weekend search
src/charts.tsx              hand-rolled SVG charts
src/views/                  Paycheck, Plan, Time Off, Settings
```

Every engine is pure and carries the test suite. Adding a tax year means adding
a block to `taxData.ts` — never touching engine code. Until that block exists,
an unpublished year borrows the latest published one and is tagged
`carriedFrom`, which Settings and the masthead surface; the app rolls into
January on last year's figures rather than refusing to open.

The active tab lives in the URL hash (`#plan/bonus`), Plan scenarios persist
with the rest of the state, and every chart has a "show as table" toggle.

## On the tax numbers

Federal brackets, standard deduction, FICA and the 2026 contribution limits come
from IRS Rev. Proc. 2025-32, IRS Notice 2025-67 and the SSA wage-base
determination. They are final for 2026.

**California is carried forward from TY2025 on purpose.** FTB indexes its
brackets to California CPI and publishes each fall, so TY2026 figures don't
exist yet — and CA payroll withholding during 2026 runs on the TY2025 schedule
anyway, which makes them the right numbers for take-home today. The app says so
in Settings. CA SDI (1.3%) *is* final for 2026, and is **uncapped** — SB 951
removed the wage ceiling in 2024, so it scales linearly with no maximum. That's
the single most commonly-wrong figure in payroll calculators.

Refresh the CA block in `taxData.ts` once FTB publishes.

## Caveats

This models a salaried projection, not your actual paystub. Real checks drift
with mid-year premium changes, bonuses, imputed income, equity vesting and
supplemental withholding. Per-paycheck federal withholding also uses IRS
Publication 15-T percentage-method tables and W-4 entries, which differ from the
annual liability computed here — treat the numbers as a planning model, not a
payroll engine.
