import type { CalibracionHoja } from '../dominio';
import { etiquetaMes, intervalosCalibracion, mesesConDecimal, textoIntervalo } from '../lib/calibraciones';

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
 * calibraciones vigentes seguidas, en meses, con su promedio y una línea discontinua en la vigencia de su
 * marca. El detalle de cada barra, al pasar el ratón; el cálculo, en `intervalosCalibracion`. Sólo pinta.
 */
export default function IntervalosCalibracion({ items, vigenciaDias }: Props) {
  const { intervalos, promedioMeses, referenciaMeses } = intervalosCalibracion(items, vigenciaDias);
  const tope = Math.max(...intervalos.map((i) => i.meses), referenciaMeses ?? 0) * 1.15;
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
          <div className="relative mt-3 h-28" role="img" aria-label={`Meses entre calibraciones: ${intervalos.map(textoIntervalo).join('; ')}.`}>
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
          <div className="flex gap-0.5" aria-hidden>
            {intervalos.map((i) => (
              <span key={i.hasta} className="min-w-0 flex-1 truncate text-center text-[10px] text-gray-500">
                {etiquetaMes(i.hasta)}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
