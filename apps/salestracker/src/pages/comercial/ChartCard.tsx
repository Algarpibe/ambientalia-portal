import type { ReactNode } from 'react';

/** Marco de tarjeta cálido compartido por las gráficas de Análisis (Comercial/
 *  Margen/Forecast/Exploración). Mismo lenguaje que la Home (.st-card). */
export default function ChartCard({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="st-card p-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-[15px] font-bold tracking-tight text-[#24231F]">{title}</h3>
          {subtitle && <p className="text-xs text-[#9A968E] font-medium mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}
