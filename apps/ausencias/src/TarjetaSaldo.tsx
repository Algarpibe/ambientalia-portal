import { CalendarClock } from 'lucide-react';
import type { SaldoVacaciones } from './api';
import { formatFecha } from './dominio';

// La tarjeta del saldo. Se usa en tres sitios (formulario, «Mis solicitudes» y
// bandeja), por eso vive aparte y no dentro del formulario.

interface Props {
  saldo: SaldoVacaciones;
  /** Días que se están pidiendo ahora mismo, para avisar si no caben. */
  diasPedidos?: number;
  /** Encabezado alternativo, para cuando el saldo es de otra persona. */
  titulo?: string;
}

/** Un decimal, y sin el «,0» cuando es entero. */
function dias(n: number): string {
  return n.toLocaleString('es-CO', { maximumFractionDigits: 1 });
}

export default function TarjetaSaldo({ saldo, diasPedidos = 0, titulo = 'Tu saldo de vacaciones' }: Props) {
  if (!saldo.configurado) {
    return (
      <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
        Saldo de vacaciones sin configurar. Un administrador tiene que fijar el punto de partida
        en la pestaña <b>Saldos</b>.
      </div>
    );
  }

  // Lo que está pendiente de aprobar todavía no ha bajado el saldo firme, pero
  // se va a ir: si no se descuenta aquí, se podrían pedir tres veces los mismos
  // días antes de que nadie apruebe la primera solicitud.
  const pedible = saldo.disponible - saldo.enTramite;
  const seExcede = diasPedidos > 0 && diasPedidos > pedible;

  return (
    <div
      className={`mb-4 rounded-xl border px-3 py-2 text-sm ${
        seExcede ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-900'
      }`}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <CalendarClock className="h-4 w-4 shrink-0" />
        {titulo}: <b className="tabular-nums">{dias(saldo.disponible)}</b> días
      </p>
      <p className="mt-0.5 text-xs opacity-80">
        Partiendo de {dias(saldo.saldoCorte)} el {formatFecha(saldo.fechaCorte)}, más{' '}
        {dias(saldo.devengadas)} devengados y menos {dias(saldo.disfrutadas)} disfrutados.
        {saldo.enTramite > 0 && <> Hay {dias(saldo.enTramite)} más pendientes de aprobar.</>}
      </p>
      {seExcede && (
        <p className="mt-1 font-medium">
          Estás pidiendo {dias(diasPedidos)} días y te quedan {dias(Math.max(0, pedible))}. Puedes
          enviar la solicitud igualmente: lo decide quien aprueba.
        </p>
      )}
    </div>
  );
}
