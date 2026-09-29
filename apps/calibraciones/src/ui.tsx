/**
 * Shared UI primitives, in the portal's visual language (white cards, gray
 * borders, blue accent, rounded-xl). Touch targets are at least 44 px high:
 * the app is used on a lab tablet.
 */
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import type { Tone } from './lib/domain';

const TONE_BADGE: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  gray: 'bg-gray-100 text-gray-600 ring-gray-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE_BADGE[tone]}`}>
      {children}
    </span>
  );
}

/** Traffic light for a pass/fail value; null = not evaluated. */
export function PassMark({ pass }: { pass: boolean | null | undefined }) {
  if (pass === null || pass === undefined) return <span className="text-gray-400">—</span>;
  return pass ? (
    <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
      <CheckCircle2 className="h-4 w-4" aria-hidden /> Cumple
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 font-medium text-red-700">
      <XCircle className="h-4 w-4" aria-hidden /> No cumple
    </span>
  );
}

const ALERT: Record<'red' | 'amber' | 'blue' | 'green', { box: string; icon: ReactNode }> = {
  red: { box: 'border-red-200 bg-red-50 text-red-800', icon: <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> },
  amber: {
    box: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />,
  },
  blue: { box: 'border-blue-200 bg-blue-50 text-blue-900', icon: <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> },
  green: {
    box: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    icon: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />,
  },
};

export function Alert({ tone, title, children }: { tone: keyof typeof ALERT; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${ALERT[tone].box}`}>
      {ALERT[tone].icon}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300',
  secondary: 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:text-gray-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  ghost: 'text-gray-700 hover:bg-gray-100 disabled:text-gray-400',
};

export function Button({
  variant = 'secondary',
  busy = false,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const INPUT =
  'block w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-500';

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT} ${props.className ?? ''}`} />;
}

/** Decimal input: text + inputMode so a tablet shows the numeric keypad and comma decimals are kept as typed. */
export function DecimalInput({ invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      {...props}
      aria-invalid={invalid || undefined}
      className={`${INPUT} tabular-nums ${invalid ? 'border-red-400 bg-red-50' : ''} ${props.className ?? ''}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${INPUT} ${props.className ?? ''}`} />;
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm ${checked ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'} ${disabled ? 'cursor-default opacity-80' : ''}`}>
      <input
        type="checkbox"
        className="h-5 w-5 shrink-0 accent-emerald-600"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-gray-800">{label}</span>
    </label>
  );
}

export function Loading({ text = 'Cargando…' }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-gray-500">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> {text}
    </div>
  );
}

/** Horizontal scroll lives INSIDE the table container, never on the page. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">{children}</div>;
}

export const TH = 'whitespace-nowrap border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-600';
export const TD = 'border-b border-gray-100 px-3 py-2 align-middle';
export const NUM = 'text-right tabular-nums';

/** Segmented control (unit toggle, sub-sections). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-gray-300 bg-white p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`min-h-[40px] rounded-lg px-4 text-sm font-medium ${value === v ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Downloads a text file (CSV template) in the browser. */
export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads a binary file (PDF, XLSX) in the browser. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
