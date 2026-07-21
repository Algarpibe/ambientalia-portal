import type { ReactNode } from 'react';

/** Tarjeta del dashboard: panel blanco redondeado con sombra suave, badge de icono
 *  circular + título, y slot opcional a la derecha (leyenda). Propia de la Home
 *  para no alterar el ChartCard compartido por las otras pestañas. */
export default function HomeCard({
  icon,
  title,
  subtitle,
  right,
  className = '',
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`st-card p-6 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <span className="st-ic">{icon}</span>
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-[#24231F]">{title}</h3>
            {subtitle && <p className="text-xs text-[#9A968E] font-medium mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Leyenda de chips para la cabecera (series de las tarjetas de 2 series). */
export function ChipLegend({ items }: { items: { color: string; label: string; line?: boolean }[] }) {
  return (
    <div className="st-legend">
      {items.map((it) => (
        <span className="it" key={it.label}>
          <span className={`sw${it.line ? ' line' : ''}`} style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
