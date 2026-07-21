import type { ReactNode } from 'react';

/** Tarjeta cálida del dashboard: panel redondeado con sombra suave, badge de icono
 *  circular opcional + título, y slot a la derecha (leyenda/controles). */
export default function Card({
  icon,
  title,
  subtitle,
  right,
  className = '',
  children,
}: {
  icon?: ReactNode;
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const hasHeader = icon || title || subtitle || right;
  return (
    <div className={`st-card p-6 ${className}`}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            {icon && <span className="st-ic">{icon}</span>}
            {(title || subtitle) && (
              <div>
                {title && <h3 className="text-[15px] font-bold tracking-tight text-[#24231F]">{title}</h3>}
                {subtitle && <p className="text-xs text-[#9A968E] font-medium mt-0.5">{subtitle}</p>}
              </div>
            )}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/** Leyenda de chips para la cabecera (series de 2+). */
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
