/**
 * Primitivas de UI en el lenguaje visual del portal (tarjetas blancas, bordes
 * grises, acento azul, rounded-xl). Botones de al menos 44 px de alto.
 */
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { ETIQUETA_ESTADO, type EstadoCalibracion } from './dominio';

/** Clases por estado. Literales completos: Tailwind sólo genera las clases que lee tal cual. */
export const TONO: Record<EstadoCalibracion, { badge: string; dot: string; text: string; bar: string; chip: string }> = {
  FUERA_CICLO: { badge: 'bg-gray-100 text-gray-600 ring-gray-200', dot: 'bg-gray-400', text: 'text-gray-500', bar: 'bg-gray-400', chip: 'border-l-gray-400' },
  VENCIDA: { badge: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500', text: 'text-red-600', bar: 'bg-red-500', chip: 'border-l-red-500' },
  VENCE_30: { badge: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-500', text: 'text-orange-600', bar: 'bg-orange-500', chip: 'border-l-orange-500' },
  VENCE_60: { badge: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-400', text: 'text-amber-700', bar: 'bg-amber-400', chip: 'border-l-amber-400' },
  VENCE_90: { badge: 'bg-lime-50 text-lime-800 ring-lime-200', dot: 'bg-lime-500', text: 'text-lime-700', bar: 'bg-lime-500', chip: 'border-l-lime-500' },
  AL_DIA: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700', bar: 'bg-emerald-500', chip: 'border-l-emerald-500' },
  SIN_FECHA: { badge: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400', text: 'text-slate-500', bar: 'bg-slate-300', chip: 'border-l-slate-400' },
};

export function EstadoBadge({ estado }: { estado: EstadoCalibracion }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONO[estado].badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONO[estado].dot}`} aria-hidden />
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

export function Tag({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'blue' | 'amber' }) {
  const t = { gray: 'bg-gray-100 text-gray-600', blue: 'bg-blue-50 text-blue-700', amber: 'bg-amber-50 text-amber-800' }[tone];
  return <span className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${t}`}>{children}</span>;
}

export function Card({ title, hint, actions, children, className = '' }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
            {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300',
  secondary: 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:text-gray-400',
  ghost: 'text-gray-700 hover:bg-gray-100 disabled:text-gray-400',
};

export function Button({ variant = 'secondary', busy = false, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
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

const ALERT = {
  red: { box: 'border-red-200 bg-red-50 text-red-800', icon: <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> },
  amber: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> },
  blue: { box: 'border-blue-200 bg-blue-50 text-blue-900', icon: <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> },
  green: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> },
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

export function Loading({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {texto}
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
}

/** Panel lateral derecho (ficha de un equipo). */
export function Drawer({ title, subtitle, onClose, children }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-gray-900">{title}</div>
            {subtitle && <div className="text-sm text-gray-500">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  );
}

/** Diálogo centrado. */
export function Modal({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
