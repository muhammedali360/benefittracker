import { useState } from 'react'

type Native = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'prefix'>

interface Props extends Native {
  /** null only ever appears when `nullable` is set. */
  value: number | null
  onChange: (next: number | null) => void
  /** Empty field means "no value" rather than zero (caps, limits). */
  nullable?: boolean
  /** Unit shown inside the field: "%", "$", "h", "days". */
  prefix?: string
  suffix?: string
  /** Display rounding, so 0.07 × 100 never renders as 7.000000000000001. */
  decimals?: number
}

/**
 * Zero renders as an empty field: every number here treats 0 as "nothing",
 * so the placeholder ("0", "none", "e.g. 120000") says the same thing and the
 * cursor lands in an empty box instead of after a digit you have to delete.
 */
const fmt = (n: number | null, decimals: number) =>
  n === null || n === 0 ? '' : String(Number(n.toFixed(decimals)))

/**
 * A number field that lets you type. The naive `value={n || ''}` pattern makes
 * a typed "0" vanish, swallows "0." on the way to "0.5", and shows a placeholder
 * that looks like a saved value. This keeps the raw text locally and commits
 * every parseable state, so what you type is what you see.
 */
export function NumberInput({
  value,
  onChange,
  nullable = false,
  prefix,
  suffix,
  decimals = 4,
  className,
  onBlur,
  ...rest
}: Props) {
  const [text, setText] = useState(() => fmt(value, decimals))
  const [seen, setSeen] = useState(value)

  // An external change (reset, import, a different bucket's hours-per-day)
  // resyncs the text; a change that came from this field does not.
  if (value !== seen) {
    setSeen(value)
    const parsed = text.trim() === '' ? (nullable ? null : 0) : Number(text)
    if (parsed !== value) setText(fmt(value, decimals))
  }

  const input = (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      className={className}
      value={text}
      onChange={(e) => {
        const v = e.target.value
        setText(v)
        if (v.trim() === '') {
          onChange(nullable ? null : 0)
          return
        }
        const n = Number(v)
        if (Number.isFinite(n)) onChange(n)
      }}
      onBlur={(e) => {
        // Tidy "007" or "5." on the way out. A typed "0" stays put — turning
        // it into the placeholder would look like the entry was lost.
        const n = Number(text)
        if (text.trim() !== '' && Number.isFinite(n) && n !== 0) setText(fmt(n, decimals))
        onBlur?.(e)
      }}
    />
  )

  if (!prefix && !suffix) return input
  return (
    <span className="num-wrap">
      {prefix && <span className="adorn">{prefix}</span>}
      {input}
      {suffix && <span className="adorn">{suffix}</span>}
    </span>
  )
}
