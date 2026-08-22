import { CalendarClock } from 'lucide-react';
import type { SaldoVacaciones } from './api';
import { formatDias, formatFecha, pedible } from './dominio';

// La tarjeta del saldo. Se usa en dos sitios (formulario y bandeja), por eso
// vive aparte y no dentro del formulario.

/**
 * Qué se puede hacer con el aviso de exceso, que es lo único que cambia entre
 * los sitios donde esta tarjeta se pinta:
 *
 * - `puede_sobregirarse`: quien lee es quien pide y está exento del tope (admin).
 *   Puede mandarla y que decida quien firma.
 * - `no_puede_sobregirarse`: quien lee es quien pide y NO está exento. El botón
 *   está apagado y el servidor contestaría 409.
 * - `saldo_ajeno`: quien lee es quien firma, mirando el saldo de otra persona.
 *   No se le pide nada: la solicitud ya está enviada.
 */
export type CierreDelAviso = 'puede_sobregirarse' | 'no_puede_sobregirarse' | 'saldo_ajeno';

interface Props {
  saldo: SaldoVacaciones;
  /**
   * Quién lee el aviso de exceso y qué puede hacer al respecto.
   *
   * Obligatorio y SIN valor por defecto a propósito: es el candado. Esta app no
   * tiene tests, así que lo único que impide que un tercer sitio herede una
   * frase que allí sea mentira es que no compile sin elegir. Un defecto —el que
   * fuera— reabriría justo el fallo que este prop vino a cerrar: la tarjeta
   * decía «puedes enviarla igualmente» a todo el mundo desde que las vacaciones
   * dejaron de poder pedirse por encima del saldo, y quien no era admin veía esa
   * frase junto a un botón gris.
   */
  cierre: CierreDelAviso;
  /** Días que se están pidiendo ahora mismo, para avisar si no caben. */
  diasPedidos?: number;
  /** Encabezado alternativo, para cuando el saldo es de otra persona. */
  titulo?: string;
  /**
   * Callar la tarjeta cuando solo repetiría el número que ya está en la
   * cabecera. Lo usa el formulario, que la tiene a un palmo del indicador; la
   * bandeja NO lo pasa, porque allí el saldo es de otra persona y no está en
   * ninguna otra parte de la pantalla.
   *
   * No la calla del todo: el aviso de «sin configurar» y el de exceso de días
   * siguen saliendo, que es lo único que esta tarjeta dice y el indicador no.
   */
  soloSiAvisa?: boolean;
}

export default function TarjetaSaldo({
  saldo,
  cierre,
  diasPedidos = 0,
  titulo = 'Tu saldo de vacaciones',
  soloSiAvisa = false,
}: Props) {
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
  //
  // Es a propósito que este número NO coincida con `saldo.disponible`, que es el
  // firme y no resta lo pendiente (ver `calcularSaldo`: «media firma NO
  // descuenta»). Son dos preguntas distintas —cuánto tengo y cuánto puedo pedir
  // sin descubrirme— y por eso el aviso de abajo explica la diferencia en vez de
  // soltar dos cifras que parecen contradecirse.
  //
  // Se usa la función compartida de `dominio.ts` en vez de la resta a pelo: es
  // espejo de la del servidor y redondea, porque `disponible − enTramite` sobre
  // floats da cosas como 3.9000000000000004 y sin redondear las dos mitades
  // discreparían justo en el borde en el que la pantalla dice «te falta 0».
  const puedePedir = pedible(saldo);
  const seExcede = diasPedidos > 0 && diasPedidos > puedePedir;

  // Con `soloSiAvisa`, sin exceso no hay nada que esta tarjeta cuente que no
  // cuente ya el indicador de la cabecera. La comprobación va DESPUÉS de la de
  // «sin configurar» a propósito: ese cartel sí es exclusivo de aquí, porque la
  // cabecera no enseña nada cuando falta el punto de partida.
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
      <p className="mt-0.5 text-xs opacity-80">
        Partiendo de {formatDias(saldo.saldoCorte)} el {formatFecha(saldo.fechaCorte)}, más{' '}
        {formatDias(saldo.devengadas)} devengados y menos {formatDias(saldo.disfrutadas)} disfrutados.
        {saldo.enTramite > 0 && <> Hay {formatDias(saldo.enTramite)} más pendientes de aprobar.</>}
      </p>
      {seExcede && (
        <p className="mt-1 font-medium">
          {/* El déficit real, sin `Math.max(0, …)`. Enseñar «te quedan 0» cuando
              faltan casi cinco días redondea el rojo a cero y borra justo el
              dato por el que este aviso existe. */}
          Estás pidiendo {formatDias(diasPedidos)} {diasPedidos === 1 ? 'día' : 'días'} y te faltan{' '}
          {formatDias(diasPedidos - puedePedir)}.
          {/* De dónde sale el número. Sin esta frase la tarjeta enseña un saldo
              arriba y otro distinto abajo, y parece que se contradice: lo que
              cambia entre los dos es lo que está esperando firma. */}
          {saldo.enTramite > 0 && (
            <>
              {' '}
              En la cuenta entran los {formatDias(saldo.enTramite)} días que ya tienes pendientes de
              aprobar: se descontarán en cuanto alguien los firme.
            </>
          )}{' '}
          {/* La última frase es la única que depende de quién esté leyendo, y
              tiene que decir la verdad sobre el botón que hay debajo. Las tres
              ramas están escritas enteras y no compuestas por trozos: son tres
              consejos distintos, no un texto con huecos.

              `saldo_ajeno` no dice NADA. Quien firma no tiene ninguna acción que
              tomar sobre el envío —ya está enviado— y las dos frases de arriba,
              con los números, son justo lo que necesita para decidir. Cualquier
              cierre en segunda persona ahí le hablaría de un botón que no está
              mirando. */}
          {cierre === 'puede_sobregirarse' && <>Puedes enviar la solicitud igualmente: lo decide quien aprueba.</>}
          {cierre === 'no_puede_sobregirarse' && (
            <>
              {/* No promete que esperar una firma libere días, porque no lo hace:
                  aprobar lo pendiente baja el disponible y lo pedible se queda
                  igual. Lo que sí crece solo es el devengo — la diferencia de
                  fondo con los compensatorios, que no se devengan y por eso su
                  tarjeta remata mandando a administración y ya. */}
              No puedes enviarla: ajusta las fechas o espera a devengar los días que faltan. Si crees
              que tu saldo no está bien, habla con administración.
            </>
          )}
        </p>
      )}
    </div>
  );
}
