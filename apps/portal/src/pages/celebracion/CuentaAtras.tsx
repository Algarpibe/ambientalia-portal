import { useEffect, useState } from 'react';
import { cuentaAtras } from './fechas';
import { FUENTE_TITULOS } from './marca';

const CAJAS = [
  { clave: 'dias', texto: 'Días', color: '#D81B60' },
  { clave: 'horas', texto: 'Horas', color: '#F47920' },
  { clave: 'minutos', texto: 'Minutos', color: '#008556' },
  { clave: 'segundos', texto: 'Segundos', color: '#3F3D99' },
] as const;

/**
 * La hora se lee solo dentro del efecto: leerla al pintar (`new Date()`) lo
 * marca `react-hooks/purity`. Hasta el primer tic se ven «--», como en la
 * invitación original.
 */
export default function CuentaAtras({ objetivo }: { objetivo: string }) {
  const [ahora, setAhora] = useState<number | null>(null);

  useEffect(() => {
    const tic = () => setAhora(Date.now());
    tic();
    const id = window.setInterval(tic, 1000);
    return () => window.clearInterval(id);
  }, []);

  const cuenta = ahora === null ? null : cuentaAtras(new Date(objetivo), new Date(ahora));
  return (
    <div className="mx-auto grid max-w-lg grid-cols-4 gap-2 sm:gap-3" role="timer" aria-label="Cuenta atrás">
      {CAJAS.map((c) => (
        <div
          key={c.clave}
          className="rounded-2xl border border-[#E6E8EF] bg-white px-1 py-3 shadow-sm"
          style={{ borderTop: `4px solid ${c.color}` }}
        >
          <span className="block text-2xl font-black text-[#22252E] sm:text-4xl" style={{ fontFamily: FUENTE_TITULOS }}>
            {cuenta ? String(cuenta[c.clave]).padStart(2, '0') : '--'}
          </span>
          <span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-gray-500 sm:text-xs">{c.texto}</span>
        </div>
      ))}
    </div>
  );
}
