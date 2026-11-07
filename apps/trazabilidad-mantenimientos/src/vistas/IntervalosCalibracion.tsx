import type { CalibracionHoja } from '../dominio';
import { ejeMeses, etiquetaMes, intervalosCalibracion, mesesConDecimal, textoIntervalo } from '../lib/calibraciones';

interface Props {
  /** El historial de calibraciones del equipo (el mismo de la tabla). */
  items: readonly CalibracionHoja[];
  /** La vigencia de su marca (o de su contrato) en días; `null` = sin vencimiento: no hay línea de referencia. */
  vigenciaDias: number | null;
}

/** 12 → «12»; 5,9 → «5,9». */
const textoReferencia = (meses: number): string => (Number.isInteger(meses) ? String(meses) : mesesConDecimal(meses));

/**
 * «Tiempo entre calibraciones» (ficha de un equipo, 07/11/2026): una barra por cada intervalo entre dos
 * calibraciones vigentes seguidas, en meses, con su promedio, un eje Y en meses (`ejeMeses`, con líneas guía
 * suaves) y una línea discontinua en la vigencia de su marca. El detalle de cada barra, al pasar el ratón; el
 * cálculo, en `intervalosCalibracion`. Sólo pinta.
 */
export default function IntervalosCalibracion({ items, vigenciaDias }: Props) {
  const { intervalos, promedioMeses, referenciaMeses } = intervalosCalibracion(items, vigenciaDias);
  const { tope, marcas } = ejeMeses(Math.max(0, ...intervalos.map((i) => i.meses), referenciaMeses ?? 0));
  const alto = (meses: number): string => `${(meses / tope) * 100}%`;

  return (
    <section aria-labelledby="ficha-intervalos" className="flex flex-col gap-2 border-t border-gray-200 pt-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p id="ficha-intervalos" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Tiempo entre calibraciones
        </p>
        {promedioMeses !== null && (
          <p className="text-gray-600">
            promedio <strong className="text-base font-semibold tabular-nums text-gray-900">{mesesConDecimal(promedioMeses)}</strong> meses
          </p>
        )}
      </div>
      {intervalos.length === 0 ? (
        <p className="text-gray-500">Hacen falta al menos dos calibraciones vigentes para calcularlo.</p>
      ) : (
        <>
          <p className="text-[10px] leading-none text-gray-500" aria-hidden>
            meses
          </p>
          <div className="mt-1 flex gap-2">
            {/* Eje Y: las marcas, a la altura de su línea guía. */}
            <div className="relative h-28 w-6 shrink-0" aria-hidden>
              {marcas.map((m) => (
                <span key={m} className="absolute right-0 translate-y-1/2 text-[10px] leading-none tabular-nums text-gray-500" style={{ bottom: alto(m) }}>
                  {m}
                </span>
              ))}
            </div>
            <div className="relative h-28 min-w-0 flex-1" role="img" aria-label={`Meses entre calibraciones: ${intervalos.map(textoIntervalo).join('; ')}.`}>
              {marcas.slice(1).map((m) => (
                <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-gray-100" style={{ bottom: alto(m) }} />
              ))}
              <div className="absolute inset-0 flex items-end gap-0.5 border-b border-gray-300">
                {intervalos.map((i) => (
                  // Toda la columna responde al ratón, no sólo la barra.
                  <div key={i.hasta} title={textoIntervalo(i)} className="group flex h-full min-w-0 flex-1 items-end justify-center">
                    <div className="w-full max-w-12 rounded-t bg-blue-500 group-hover:bg-blue-600" style={{ height: alto(i.meses) }} />
                  </div>
                ))}
              </div>
              {referenciaMeses !== null && (
                <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-gray-500" style={{ bottom: alto(referenciaMeses) }}>
                  <span className="absolute -top-4 right-0 bg-white px-1 text-[10px] leading-4 text-gray-600">vigencia {textoReferencia(referenciaMeses)} meses</span>
                </div>
              )}
            </div>
          </div>
          {/* Los meses de cada barra, alineados con el área de las barras (el hueco es el del eje Y). */}
          <div className="flex gap-2" aria-hidden>
            <div className="w-6 shrink-0" />
            <div className="flex min-w-0 flex-1 gap-0.5">
              {intervalos.map((i) => (
                <span key={i.hasta} className="min-w-0 flex-1 truncate text-center text-[10px] text-gray-500">
                  {etiquetaMes(i.hasta)}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
