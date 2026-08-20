import { CalendarClock } from 'lucide-react';
import type { SaldoCompensatorios } from './api';
import { formatDias, formatFecha, pedible } from './dominio';

// La tarjeta de la bolsa de compensatorios. Se usa en dos sitios (formulario y
// bandeja), por eso vive aparte y no dentro del formulario.
//
// Hermana de `TarjetaSaldo` y NO una variante suya. Las tres frases que dice
// difieren por motivos distintos —el desglose no tiene devengo que contar, y el
// aviso de exceso no puede prometer lo mismo porque estos días no aparecen
// solos— y fundirlas en un componente con un `tipo` produciría el mismo problema
// de «dos formas en una función» que ya documenta `cambiaLaHoja` como su parte
// más frágil. Mantener `TarjetaSaldo` intacta es además lo que garantiza que
// esta función no pueda romper el saldo de vacaciones.

interface Props {
  saldo: SaldoCompensatorios;
  /** Días que se están pidiendo ahora mismo, para avisar si no caben. */
  diasPedidos?: number;
  /** Encabezado alternativo, para cuando la bolsa es de otra persona. */
  titulo?: string;
  /** Callar la tarjeta cuando no tiene nada que avisar. Ver `TarjetaSaldo`. */
  soloSiAvisa?: boolean;
}

export default function TarjetaCompensatorios({
  saldo,
  diasPedidos = 0,
  titulo = 'Tu bolsa de compensatorios',
  soloSiAvisa = false,
}: Props) {
  if (!saldo.configurado) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
        {titulo}: todavía sin configurar. Hace falta que un administrador fije el punto de partida.
      </div>
    );
  }

  // Mismo criterio que en vacaciones: lo pedible descuenta lo que espera firma,
  // porque se irá en cuanto alguien lo apruebe. Se usa la función compartida de
  // `dominio.ts` y no una resta a mano: tiene que redondear igual que el
  // servidor, o los dos discreparían justo en el borde de «te falta 0».
  const puedePedir = pedible(saldo);
  const seExcede = diasPedidos > 0 && diasPedidos > puedePedir;

  if (soloSiAvisa && !seExcede) return null;

  return (
    <div
      className={`rounded-xl border px-3 py-2 text-sm ${
        seExcede ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-900'
      }`}
    >
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium">
        <span className="flex items-center gap-1.5">
          <CalendarClock className="h-4 w-4 shrink-0" />
          {titulo}:
        </span>
        <span>
          <b className="tabular-nums">{formatDias(saldo.disponible)}</b> días
        </span>
      </p>
      {/* Sin el término del devengo, que en esta bolsa no existe: son solo los
          días de partida menos los que ya se han disfrutado. */}
      <p className="mt-0.5 text-xs opacity-80">
        Partiendo de {formatDias(saldo.saldoCorte)} el {formatFecha(saldo.fechaCorte)}, menos{' '}
        {formatDias(saldo.disfrutadas)} disfrutados.
        {saldo.enTramite > 0 && <> Hay {formatDias(saldo.enTramite)} más pendientes de aprobar.</>}
      </p>
      {seExcede && (
        <p className="mt-1 font-medium">
          {/* El déficit real, sin `Math.max(0, …)`, por lo mismo que en la tarjeta
              de vacaciones: redondear el rojo a cero borra el dato por el que
              este aviso existe. */}
          Estás pidiendo {formatDias(diasPedidos)} {diasPedidos === 1 ? 'día' : 'días'} y te faltan{' '}
          {formatDias(diasPedidos - puedePedir)}.
          {saldo.enTramite > 0 && (
            <>
              {' '}
              En la cuenta entran los {formatDias(saldo.enTramite)} días que ya tienes pendientes de
              aprobar: se descontarán en cuanto alguien los firme.
            </>
          )}{' '}
          {/* Lo contrario de lo que dice la tarjeta de vacaciones —«puedes enviarla
              igualmente: lo decide quien aprueba»—, y por una razón de fondo: allí
              el saldo sigue creciendo solo y quien firma puede asumir el adelanto;
              aquí no crece nada y no hay nada que nadie pueda autorizar. El
              servidor lo rechaza con un 409, así que decir otra cosa sería mandar
              a la persona a un botón que no funciona. */}
          No puedes enviarla: los compensatorios no se devengan con el tiempo, se ganan por horas o
          días extra y hay que otorgarlos. Si crees que te faltan días por reconocer, habla con
          administración.
        </p>
      )}
    </div>
  );
}
