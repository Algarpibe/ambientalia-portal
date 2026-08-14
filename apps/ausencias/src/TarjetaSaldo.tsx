import { CalendarClock } from 'lucide-react';
import type { SaldoVacaciones } from './api';
import { formatDias, formatFecha } from './dominio';

// La tarjeta del saldo. Se usa en dos sitios (formulario y bandeja), por eso
// vive aparte y no dentro del formulario.

interface Props {
  saldo: SaldoVacaciones;
  /** Días que se están pidiendo ahora mismo, para avisar si no caben. */
  diasPedidos?: number;
  /** Encabezado alternativo, para cuando el saldo es de otra persona. */
  titulo?: string;
}

export default function TarjetaSaldo({ saldo, diasPedidos = 0, titulo = 'Tu saldo de vacaciones' }: Props) {
  if (!saldo.configurado) {
    return (
      // Usa `titulo` (no un texto fijo) porque en la bandeja esta tarjeta es de
      // otra persona: sin eso, el aprobador ve un cartel sin saber de quién es.
      // Y no manda a nadie a la pestaña Saldos: un aprobador que no es admin no
      // la tiene, y el mensaje debe valer igual para «mi saldo» que para el de
      // otro.
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
        {titulo}: todavía sin configurar. Hace falta que un administrador fije el punto de partida.
      </div>
    );
  }

  // Lo pedible descuenta lo que está en trámite porque, aunque todavía no ha
  // bajado el saldo firme, se va a ir en cuanto alguien lo apruebe. Ojo: esta
  // cuenta solo es tan fresca como el `saldo` que llega por props. Si el
  // consumidor no lo refresca tras crear o decidir una solicitud, la tarjeta
  // sigue enseñando el número de antes de esa operación (ver App.tsx: onCreada
  // y onDecidida piden datos nuevos justo para evitar eso).
  const pedible = saldo.disponible - saldo.enTramite;
  const seExcede = diasPedidos > 0 && diasPedidos > pedible;

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
      <p className="mt-0.5 text-xs opacity-80">
        Partiendo de {formatDias(saldo.saldoCorte)} el {formatFecha(saldo.fechaCorte)}, más{' '}
        {formatDias(saldo.devengadas)} devengados y menos {formatDias(saldo.disfrutadas)} disfrutados.
        {saldo.enTramite > 0 && <> Hay {formatDias(saldo.enTramite)} más pendientes de aprobar.</>}
      </p>
      {seExcede && (
        <p className="mt-1 font-medium">
          Estás pidiendo {formatDias(diasPedidos)} días y te quedan {formatDias(Math.max(0, pedible))}. Puedes
          enviar la solicitud igualmente: lo decide quien aprueba.
        </p>
      )}
    </div>
  );
}
