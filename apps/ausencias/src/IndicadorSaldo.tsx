import { CalendarClock } from 'lucide-react';
import type { SaldoCompensatorios, SaldoVacaciones } from './api';
import { formatDias } from './dominio';

// El indicador de los saldos, en las dos superficies donde se enseñan: la
// cabecera de la app y el widget del dashboard.
//
// La REGLA de qué número se muestra vive aquí y solo aquí —el grande es
// `disponible`, y `enTramite` aparece como aviso únicamente cuando hay algo
// pendiente—. Si cada superficie la escribiera por su cuenta, la primera vez que
// alguien tocara una se separarían, y el síntoma sería que el dashboard y la app
// dicen números distintos de la misma persona.
//
// Desde que hay dos bolsas, también vive aquí CUÁNTAS columnas se pintan: quien
// llama pasa las dos y este componente decide. Repartir esa decisión entre la
// cabecera y el widget es la misma trampa de antes con otra cara.
//
// No se enseña en grande el «pedible» (`disponible − enTramite`) porque
// `disponible` es lo que ve un administrador en el panel de Saldos: habría dos
// cifras para «mi saldo» sin nada que explicara la diferencia. Pero ocultar el
// trámite reproduce un fallo ya reportado —pedir 10 días, luego otros 10, y que
// la cifra siga diciendo que quedan 12—. De ahí la línea de aviso.
//
// `TarjetaSaldo` y `TarjetaCompensatorios` son otra cosa y no se fusionan con
// este: además del saldo, avisan de que los días que se están escribiendo en el
// formulario no caben.

/**
 * Lo que este componente necesita de una bolsa, sea cual sea.
 *
 * Estructural a propósito: `SaldoVacaciones` y `SaldoCompensatorios` tienen
 * formas distintas —la segunda no devenga— pero comparten estos tres campos, así
 * que las dos encajan aquí sin conversión ni tipo común artificial.
 */
interface Bolsa {
  configurado: boolean;
  disponible: number;
  enTramite: number;
}

interface Props {
  /** Null/undefined = sin ficha, cálculo fallido, o un hub-api sin la clave. */
  saldo: SaldoVacaciones | null | undefined;
  compensatorios?: SaldoCompensatorios | null;
  variante: 'cabecera' | 'widget';
}

export default function IndicadorSaldo({ saldo, compensatorios, variante }: Props) {
  const hayVacaciones = saldo?.configurado === true;
  const hayCompensatorios = compensatorios?.configurado === true;
  // Sin ninguna bolsa configurada no se pinta NADA, ni un cero: un 0,0 en grande
  // se lee como «te has gastado los días», que es una cosa muy distinta de «nadie
  // ha fijado todavía tu punto de partida».
  if (!hayVacaciones && !hayCompensatorios) return null;

  const dos = hayVacaciones && hayCompensatorios;

  // Dos ramas explícitas en vez de una sola plantilla con ternarios por clase:
  // las jerarquías visuales son distintas —en el widget el número es el
  // protagonista, en la cabecera acompaña al título— y mezclarlas hace ilegibles
  // las dos.
  if (variante === 'widget') {
    return (
      // En horizontal, y es la restricción que manda: el widget mide 4×3 y ese
      // tamaño NO se puede ampliar para quien ya lo tenga añadido, porque se
      // copió a su localStorage al anclarlo. Dos cifras apiladas no caben; una al
      // lado de otra sí, porque suman ancho y no alto.
      <div className="flex w-full items-stretch justify-center divide-x divide-gray-200">
        {hayVacaciones && (
          <Cifra bolsa={saldo} etiqueta="Vacaciones" unica={!dos} tamano={dos ? 'text-3xl' : 'text-4xl'} />
        )}
        {hayCompensatorios && (
          <Cifra bolsa={compensatorios} etiqueta="Compensatorios" unica={!dos} tamano={dos ? 'text-3xl' : 'text-4xl'} />
        )}
      </div>
    );
  }

  return (
    <div className="text-right">
      <p className="flex items-center justify-end gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        Tu saldo hoy
      </p>
      <div className="flex items-start justify-end gap-4">
        {hayVacaciones && <CifraCabecera bolsa={saldo} etiqueta={dos ? 'Vacaciones' : null} />}
        {hayCompensatorios && <CifraCabecera bolsa={compensatorios} etiqueta={dos ? 'Compensatorios' : null} />}
      </div>
    </div>
  );
}

/**
 * Un `disponible` negativo es alcanzable —una vacación aprobada que el saldo de
 * corte ya traía descontada se resta dos veces— y esto no lo arregla: es un
 * problema de datos. Pero deja de presentarlo con la misma cara que un saldo
 * sano, para que quien lo vea pregunte en vez de creérselo.
 */
function color(bolsa: Bolsa): string {
  return bolsa.disponible < 0 ? 'text-red-600' : 'text-blue-600';
}

function Cifra({
  bolsa,
  etiqueta,
  unica,
  tamano,
}: {
  bolsa: Bolsa;
  etiqueta: string;
  unica: boolean;
  tamano: string;
}) {
  return (
    <div className="flex-1 px-2 text-center">
      <p className={`${tamano} font-bold leading-none tabular-nums ${color(bolsa)}`}>{formatDias(bolsa.disponible)}</p>
      {/* Con una sola bolsa se conserva LITERALMENTE el texto de antes: quien no
          tenga compensatorios no debe notar que esto ha cambiado. */}
      <p className="mt-1 text-xs text-gray-500">{unica ? 'días disponibles' : etiqueta}</p>
      <AvisoTramite bolsa={bolsa} className="mt-1.5 text-xs" />
    </div>
  );
}

function CifraCabecera({ bolsa, etiqueta }: { bolsa: Bolsa; etiqueta: string | null }) {
  return (
    <div className="text-right">
      <p className={`text-2xl font-bold leading-none tabular-nums ${color(bolsa)}`}>
        {formatDias(bolsa.disponible)} <span className="text-sm font-medium text-gray-500">días</span>
      </p>
      {etiqueta && <p className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">{etiqueta}</p>}
      <AvisoTramite bolsa={bolsa} className="mt-0.5 text-[11px]" />
    </div>
  );
}

/** El aviso del trámite. En un solo sitio: el texto forma parte de la regla. */
function AvisoTramite({ bolsa, className }: { bolsa: Bolsa; className: string }) {
  if (bolsa.enTramite <= 0) return null;
  return <p className={`font-semibold text-amber-700 ${className}`}>{formatDias(bolsa.enTramite)} pendientes de aprobar</p>;
}
