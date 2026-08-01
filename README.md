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
dollars, because that's what it is.

## Layout

```
src/engine/taxData.ts   year-keyed tax parameters (data, with sources)
src/engine/tax.ts       paycheck math — pure functions
src/engine/pto.ts       the PTO ledger — pure functions
src/charts.tsx          hand-rolled SVG charts
src/views/              Paycheck, Time Off, Settings
```

The two engines are pure and carry the test suite. Adding a tax year means
adding a block to `taxData.ts` — never touching engine code.

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
