import { CalendarClock } from 'lucide-react';
import type { SaldoVacaciones } from './api';
import { formatDias } from './dominio';

// El indicador del saldo, en las dos superficies donde se enseña: la cabecera de
// la app y el widget del dashboard.
//
// La REGLA de qué número se muestra vive aquí y solo aquí —el grande es
// `disponible`, y `enTramite` aparece como aviso únicamente cuando hay algo
// pendiente—. Si cada superficie la escribiera por su cuenta, la primera vez que
// alguien tocara una se separarían, y el síntoma sería que el dashboard y la app
// dicen números distintos de la misma persona.
//
// No se enseña en grande el «pedible» (`disponible − enTramite`) porque
// `disponible` es lo que ve un administrador en el panel de Saldos: habría dos
// cifras para «mi saldo» sin nada que explicara la diferencia. Pero ocultar el
// trámite reproduce un fallo ya reportado —pedir 10 días, luego otros 10, y que
// la cifra siga diciendo que quedan 12—. De ahí la línea de aviso.
//
// `TarjetaSaldo` es otra cosa y no se fusiona con este: además del saldo, avisa
// de que los días que se están escribiendo en el formulario no caben.

interface Props {
  /** Solo se llama con `configurado: true`; quien llama decide qué hacer si no. */
  saldo: SaldoVacaciones;
  variante: 'cabecera' | 'widget';
}

export default function IndicadorSaldo({ saldo, variante }: Props) {
  // Un `disponible` negativo es alcanzable —una vacación aprobada que el saldo de
  // corte ya traía descontada se resta dos veces— y esto no lo arregla: es un
  // problema de datos. Pero deja de presentarlo con la misma cara que un saldo
  // sano, para que quien lo vea pregunte en vez de creérselo.
  const colorNumero = saldo.disponible < 0 ? 'text-red-600' : 'text-blue-600';

  // Dos ramas explícitas en vez de una sola plantilla con ternarios por clase:
  // las jerarquías visuales son distintas —en el widget el número es el
  // protagonista, en la cabecera acompaña al título— y mezclarlas hace ilegibles
  // las dos.
  if (variante === 'widget') {
    return (
      <div className="text-center">
        <p className={`text-4xl font-bold leading-none tabular-nums ${colorNumero}`}>{formatDias(saldo.disponible)}</p>
        <p className="mt-1 text-xs text-gray-500">días disponibles</p>
        <AvisoTramite saldo={saldo} className="mt-1.5 text-xs" />
      </div>
    );
  }

  return (
    <div className="text-right">
      <p className="flex items-center justify-end gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        Tu saldo hoy
      </p>
      <p className={`text-2xl font-bold leading-none tabular-nums ${colorNumero}`}>
        {formatDias(saldo.disponible)} <span className="text-sm font-medium text-gray-500">días</span>
      </p>
      <AvisoTramite saldo={saldo} className="mt-0.5 text-[11px]" />
    </div>
  );
}

/** El aviso del trámite. En un solo sitio: el texto forma parte de la regla. */
function AvisoTramite({ saldo, className }: { saldo: SaldoVacaciones; className: string }) {
  if (saldo.enTramite <= 0) return null;
  return <p className={`font-semibold text-amber-700 ${className}`}>{formatDias(saldo.enTramite)} pendientes de aprobar</p>;
}
