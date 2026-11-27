import type { ReactNode } from 'react';
import { FUENTE_TITULOS } from './marca';

const TONOS = {
  teal: 'bg-[#006699]/10 text-[#006699]',
  green: 'bg-[#008556]/10 text-[#008556]',
  pink: 'bg-[#D81B60]/10 text-[#D81B60]',
  orange: 'bg-[#F47920]/10 text-[#D85B00]',
  indigo: 'bg-[#3F3D99]/10 text-[#3F3D99]',
} as const;

/** Pastilla de sección («📍 Coordenadas del encuentro»). */
export function Etiqueta({ tono, children }: { tono: keyof typeof TONOS; children: ReactNode }) {
  return (
    <span
      className={`mb-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide ${TONOS[tono]}`}
    >
      {children}
    </span>
  );
}

export function Titulo({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-4 text-2xl font-black text-[#1F2229]" style={{ fontFamily: FUENTE_TITULOS }}>
      {children}
    </h2>
  );
}

export function Tarjeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[26px] border border-[#E6E8EF] bg-white/95 p-5 shadow-sm sm:p-7 ${className}`}>{children}</div>
  );
}
