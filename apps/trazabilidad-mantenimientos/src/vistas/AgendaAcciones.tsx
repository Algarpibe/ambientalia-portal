import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Unlock } from 'lucide-react';
import { api } from '../api';
import { FLUJOS_AGENDA, type EtapaProyectada, type FlujoAgenda, type PuestoAgenda, type RespuestaAgenda, type TicketEnFila } from '../dominio';
import { ETIQUETA_FLUJO, asignables, cambiarLinea, cuerpoReparto, detalleDe, hayReparto, lineasDeReparto, puestosLibres, situacionDe, type LineaReparto } from '../lib/agendaTaller';
import { usePermisos } from '../permisos';
import { Alert, Button, DESACTIVADO, Loading, Modal } from '../ui';

/**
 * Lo que se puede HACER en la agenda (lote 7b): proponer y confirmar el
 * reparto inicial, asignar un puesto desde la fila, liberarlo y marcar el
 * flujo. Cada cosa sale sólo con su permiso de /roles/me; sin él no aparece.
 * Ocultar es comodidad: la guarda de verdad es la del servidor (403).
 *
 * Toda escritura devuelve la agenda ya leída otra vez: se pone tal cual
 * (`poner`), sin pedirla de nuevo. Los errores se enseñan con su mensaje.
 */
type Dialogo = { tipo: 'reparto' } | { tipo: 'asignar'; etapa: EtapaProyectada; ticket: TicketEnFila } | { tipo: 'liberar'; numero: number } | null;
type Hacer = (pedir: () => Promise<RespuestaAgenda>, aviso: string) => Promise<string | null>;
const CAMPO = `block min-h-[44px] w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO}`;

export function useAccionesAgenda(agenda: RespuestaAgenda | null, poner: (a: RespuestaAgenda) => void, notificar: (msg: string) => void) {
  const { puede } = usePermisos();
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [ocupado, setOcupado] = useState(false);
  /** El fallo de una acción de un clic (las de un diálogo lo enseñan dentro). */
  const [error, setError] = useState<string | null>(null);

  /** Una escritura: pone la agenda que devuelve y avisa; si falla, devuelve el mensaje. */
  const hacer = useCallback<Hacer>(
    async (pedir, aviso) => {
      setOcupado(true);
      try {
        poner(await pedir());
        setError(null);
        setDialogo(null);
        notificar(aviso);
        return null;
      } catch (e) {
        return (e as Error).message;
      } finally {
        setOcupado(false);
      }
    },
    [poner, notificar],
  );
  const deUnClic = (pedir: () => Promise<RespuestaAgenda>, aviso: string) => void hacer(pedir, aviso).then(setError);

  if (!agenda) return { cabecera: null, error: null, deFila: undefined, dePuesto: undefined, deFicha: () => null, dialogos: null };

  const cabecera =
    puede('agenda.reparto') && hayReparto(agenda) ? (
      <Button variant="primary" onClick={() => setDialogo({ tipo: 'reparto' })}>
        Proponer reparto inicial
      </Button>
    ) : null;

  /** «Asignar» en la fila: sólo a quien ya está en la etapa y habiendo un puesto libre. El primero, con un clic; cualquier otro pide motivo. */
  const deFila = puede('agenda.asignar')
    ? (etapa: EtapaProyectada, t: TicketEnFila): ReactNode => {
        const libres = puestosLibres(etapa);
        if (t.situacion !== 'en_etapa' || libres.length === 0) return null;
        const primero = asignables(etapa)[0]?.numero === t.numero;
        return (
          <Button
            variant={primero ? 'primary' : 'secondary'}
            disabled={ocupado}
            title={primero ? `Es el primero de la fila: va al puesto ${libres[0]}` : 'No es el primero de la fila: hay que decir por qué'}
            aria-label={`Asignar un puesto de ${etapa.etiqueta} al ticket ${t.numero}`}
            onClick={() => (primero ? deUnClic(() => api.asignarPuesto(t.numero, etapa.etapa, libres[0]), `Ticket ${t.numero}: ${etapa.etiqueta}, puesto ${libres[0]}`) : setDialogo({ tipo: 'asignar', etapa, ticket: t }))}
          >
            Asignar
          </Button>
        );
      }
    : undefined;

  const liberar = (numero: number, conTexto: boolean): ReactNode => (
    <button
      type="button"
      onClick={() => setDialogo({ tipo: 'liberar', numero })}
      aria-label={`Liberar el puesto del ticket ${numero}`}
      title="Liberar el puesto (pide motivo)"
      className={conTexto ? 'inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50' : 'rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400'}
    >
      <Unlock className="h-4 w-4" aria-hidden /> {conTexto && 'Liberar puesto'}
    </button>
  );
  const dePuesto = puede('agenda.liberar') ? (_e: EtapaProyectada, p: PuestoAgenda): ReactNode => (p.ocupante ? liberar(p.ocupante.numero, false) : null) : undefined;

  /** Al pie de la ficha: liberar su puesto y, si la fuente no trae clasificación, marcar el flujo. */
  const deFicha = (numero: number): ReactNode => {
    const d = detalleDe(agenda, numero);
    const conPuesto = puede('agenda.liberar') && situacionDe(agenda, numero).donde === 'puesto';
    const conFlujo = puede('agenda.flujo') && d !== null && d.flujoOrigen !== 'clasificacion';
    if (!conPuesto && !conFlujo) return null;
    return (
      <div className="mt-4 flex flex-col gap-3 border-t border-gray-200 pt-4">
        {conFlujo && d && <MarcarFlujo valor={d.flujoOrigen === 'manual' ? d.flujo : ''} ocupado={ocupado} onCambio={(f) => deUnClic(() => api.marcarFlujo(numero, f), f ? `Ticket ${numero}: flujo de ${ETIQUETA_FLUJO[f].toLowerCase()}` : `Ticket ${numero}: sin marca de flujo`)} />}
        {conPuesto && <div>{liberar(numero, true)}</div>}
      </div>
    );
  };

  const cerrar = () => setDialogo(null);
  const dialogos = (
    <>
      {dialogo?.tipo === 'reparto' && <Reparto agenda={agenda} poner={poner} hacer={hacer} ocupado={ocupado} onClose={cerrar} />}
      {dialogo?.tipo === 'asignar' && <Asignar etapa={dialogo.etapa} ticket={dialogo.ticket} hacer={hacer} ocupado={ocupado} onClose={cerrar} />}
      {dialogo?.tipo === 'liberar' && <Liberar agenda={agenda} numero={dialogo.numero} hacer={hacer} ocupado={ocupado} onClose={cerrar} />}
    </>
  );
  return { cabecera, error, deFila, dePuesto, deFicha, dialogos };
}

/** El flujo a mano de un ticket sin clasificación: servicio o equipo nuevo; vacío = sin marca (vale el de la fuente). */
function MarcarFlujo({ valor, ocupado, onCambio }: { valor: FlujoAgenda | ''; ocupado: boolean; onCambio: (f: FlujoAgenda | null) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        Marcar flujo
      </label>
      <select id={id} value={valor} disabled={ocupado} onChange={(e) => onCambio(FLUJOS_AGENDA.find((f) => f === e.target.value) ?? null)} className={CAMPO}>
        <option value="">Sin marca: el que se deduce</option>
        {FLUJOS_AGENDA.map((f) => (
          <option key={f} value={f}>
            {ETIQUETA_FLUJO[f]}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-500">La fuente no trae la clasificación de este ticket. Un equipo nuevo entra directo a Proceso.</p>
    </div>
  );
}

function Motivo({ valor, onCambio, ayuda }: { valor: string; onCambio: (v: string) => void; ayuda: string }) {
  const id = useId();
  return (
    <div className="mt-3">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        Motivo (obligatorio)
      </label>
      <textarea id={id} value={valor} maxLength={500} rows={3} required onChange={(e) => onCambio(e.target.value)} className={CAMPO} />
      <p className="mt-1 text-xs text-gray-500">{ayuda}</p>
    </div>
  );
}

function Pie({ onClose, onConfirmar, texto, ocupado, disabled }: { onClose: () => void; onConfirmar: () => void; texto: string; ocupado: boolean; disabled?: boolean }) {
  return (
    <>
      <Button onClick={onClose}>Cancelar</Button>
      <Button variant="primary" busy={ocupado} disabled={disabled} onClick={onConfirmar}>
        {texto}
      </Button>
    </>
  );
}

/** Asignar a quien NO es el primero de la fila: se elige el puesto libre y se dice por qué. */
function Asignar({ etapa, ticket, hacer, ocupado, onClose }: { etapa: EtapaProyectada; ticket: TicketEnFila; hacer: Hacer; ocupado: boolean; onClose: () => void }) {
  const libres = puestosLibres(etapa);
  const [puesto, setPuesto] = useState(libres[0]);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const confirmar = () => void hacer(() => api.asignarPuesto(ticket.numero, etapa.etapa, puesto, motivo.trim()), `Ticket ${ticket.numero}: ${etapa.etiqueta}, puesto ${puesto}`).then(setError);
  return (
    <Modal title={`Asignar el ticket ${ticket.numero} en ${etapa.etiqueta}`} onClose={onClose} footer={<Pie onClose={onClose} onConfirmar={confirmar} texto="Asignar" ocupado={ocupado} disabled={motivo.trim() === ''} />}>
      {error && <Alert tone="red">{error}</Alert>}
      <p className="text-sm text-gray-600">
        Va el n.º {ticket.posicion} de la fila y el primero que puede recibir puesto es el {asignables(etapa)[0]?.numero}. Saltarse el orden queda registrado con tu correo y el motivo.
      </p>
      <label htmlFor={id} className="mb-1 mt-3 block text-sm font-medium text-gray-700">
        Puesto libre
      </label>
      <select id={id} value={puesto} onChange={(e) => setPuesto(Number(e.target.value))} className={CAMPO}>
        {libres.map((p) => (
          <option key={p} value={p}>
            Puesto {p}
          </option>
        ))}
      </select>
      <Motivo valor={motivo} onCambio={setMotivo} ayuda="Por qué pasa por delante de los que van antes." />
    </Modal>
  );
}

/** Liberar un puesto a mano: la confirmación va aquí dentro, con el motivo. */
function Liberar({ agenda, numero, hacer, ocupado, onClose }: { agenda: RespuestaAgenda; numero: number; hacer: Hacer; ocupado: boolean; onClose: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const s = situacionDe(agenda, numero);
  const donde = s.donde === 'puesto' ? `el puesto ${s.puesto.puesto} de ${s.etiqueta}` : 'su puesto';
  const confirmar = () => void hacer(() => api.liberarPuesto(numero, motivo.trim()), `Ticket ${numero}: puesto liberado`).then(setError);
  return (
    <Modal title={`Liberar el puesto del ticket ${numero}`} onClose={onClose} footer={<Pie onClose={onClose} onConfirmar={confirmar} texto="Liberar puesto" ocupado={ocupado} disabled={motivo.trim() === ''} />}>
      {error && <Alert tone="red">{error}</Alert>}
      <p className="text-sm text-gray-600">
        El ticket {numero} dejará {donde} y volverá a la fila si sigue en esa etapa. Queda registrado con tu correo y el motivo. Un puesto se libera solo cuando el ticket cambia de etapa: esto es para cuando no lo hace.
      </p>
      <Motivo valor={motivo} onCambio={setMotivo} ayuda="Por ejemplo: el equipo ya salió del taller y el ticket no se ha movido." />
    </Modal>
  );
}

/**
 * El reparto inicial: la propuesta del servidor (puesto → ticket), que se puede
 * ajustar quitando un ticket o cambiándolo por otro de la fila, y un único
 * «Confirmar». Sólo rellena puestos libres. Si entre tanto alguien ocupó uno
 * (409), se explica y se vuelve a pedir la agenda y la propuesta.
 */
function Reparto({ agenda, poner, hacer, ocupado, onClose }: { agenda: RespuestaAgenda; poner: (a: RespuestaAgenda) => void; hacer: Hacer; ocupado: boolean; onClose: () => void }) {
  const [lineas, setLineas] = useState<LineaReparto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pedir = useCallback(async (sobre: RespuestaAgenda) => {
    try {
      setLineas(lineasDeReparto(sobre, (await api.propuestaReparto()).reparto));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  // Sólo al abrir: la agenda de debajo puede refrescarse sin que eso pise lo que se está ajustando.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void pedir(agenda), [pedir]);

  const confirmar = async () => {
    const enviadas = cuerpoReparto(lineas ?? []);
    try {
      const fallo = await hacer(() => api.confirmarReparto(enviadas), `Reparto confirmado: ${enviadas.length} puesto${enviadas.length === 1 ? '' : 's'}`);
      if (fallo) throw new Error(fallo);
    } catch (e) {
      setError(`${(e as Error).message} Se ha vuelto a pedir la propuesta: revísala y confirma otra vez.`);
      setLineas(null);
      try {
        const fresca = await api.agenda();
        poner(fresca);
        await pedir(fresca);
      } catch (e2) {
        setError((e2 as Error).message);
      }
    }
  };
  const n = cuerpoReparto(lineas ?? []).length;
  return (
    <Modal title="Reparto inicial" onClose={onClose} footer={<Pie onClose={onClose} onConfirmar={() => void confirmar()} texto={`Confirmar ${n} puesto${n === 1 ? '' : 's'}`} ocupado={ocupado} disabled={n === 0} />}>
      {error && <Alert tone="red">{error}</Alert>}
      <p className="text-sm text-gray-600">Los puestos libres de cada etapa, para los tickets que ya están en ella y en el orden de su fila. Puedes quitar un ticket o cambiarlo por otro; lo que no quepa sigue en la fila. No reemplaza a nadie que ya tenga puesto.</p>
      {!lineas ? (
        !error && <Loading texto="Calculando la propuesta…" />
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {lineas.map((l) => {
            const etapa = agenda.etapas.find((e) => e.etapa === l.etapa);
            const nombre = `${l.etiqueta}, puesto ${l.puesto}`;
            return (
              <li key={`${l.etapa}-${l.puesto}`} className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3 py-2 text-sm">
                <span className="font-medium text-gray-900">{nombre}</span>
                <select
                  aria-label={`Ticket para ${nombre}`}
                  value={l.numero ?? ''}
                  disabled={ocupado}
                  onChange={(e) => setLineas(cambiarLinea(lineas, l.etapa, l.puesto, e.target.value === '' ? null : Number(e.target.value)))}
                  className={CAMPO}
                >
                  <option value="">— dejar libre —</option>
                  {(etapa ? asignables(etapa) : []).map((t) => (
                    <option key={t.numero} value={t.numero}>
                      {t.numero} · n.º {t.posicion} de la fila · {detalleDe(agenda, t.numero)?.asunto?.slice(0, 60) ?? 'sin asunto'}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
