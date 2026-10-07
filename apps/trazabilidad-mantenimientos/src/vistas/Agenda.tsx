import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { EtapaProyectada, RespuestaAgenda, TicketEnFila } from '../dominio';
import { REFRESCO_MS, detalleDe, diasEnEstado, encadenadoDe, marcasDeFila, resumenEtapa, rotuloFuente, situacionDe, textoFlujo, textoTransicion, tocaRefrescar, type TonoSaturacion } from '../lib/agendaTaller';
import { fmtFecha, fmtFechaHora } from '../lib/vistas';
import { Alert, Button, Card, Drawer, Loading, Tag } from '../ui';
import { useAccionesAgenda } from './AgendaAcciones';
import { GanttAgenda, ListaDias } from './AgendaGantt';

/**
 * Agenda del taller (lote 7): quién ocupa cada puesto de cada etapa, hasta
 * cuándo, y cuándo entrará cada ticket que espera. Todo llega calculado de
 * GET /trazabilidad/agenda; aquí sólo se pinta (`lib/agendaTaller.ts`).
 *
 * Se refresca sola cada dos minutos y sólo con la pestaña a la vista: hub-api
 * limita a 60 peticiones por minuto a toda la oficina. El asunto de cada
 * ticket es texto de terceros: va siempre como texto, nunca como HTML.
 */
interface Props {
  onConfigurar: () => void;
  notificar: (msg: string) => void;
}

const SATURACION: Record<TonoSaturacion, string> = {
  verde: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  ambar: 'bg-amber-50 text-amber-900 ring-amber-200',
  rojo: 'bg-red-50 text-red-800 ring-red-200',
  gris: 'bg-gray-100 text-gray-600 ring-gray-200',
};
const TH = 'px-2 py-2 font-semibold';
const TITULO = 'text-xs font-semibold uppercase tracking-wide text-gray-500';
type AlTicket = (numero: number) => void;

/** La agenda cargada, cuándo se leyó y cómo volver a pedirla. Una sola petición a la vez. */
function useAgenda() {
  const [datos, setDatos] = useState<RespuestaAgenda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  /** El instante de la última petición (ms): de él sale la hora de los datos y cuándo toca la siguiente. */
  const [leida, setLeida] = useState(0);
  const ultima = useRef(0);
  const enCurso = useRef(false);

  const poner = useCallback((a: RespuestaAgenda) => {
    ultima.current = Date.now();
    setLeida(ultima.current);
    setDatos(a);
    setError(null);
  }, []);
  const cargar = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    ultima.current = Date.now();
    setCargando(true);
    try {
      poner(await api.agenda());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      enCurso.current = false;
      setCargando(false);
    }
  }, [poner]);

  useEffect(() => {
    void cargar();
    // El reloj sólo mira si toca: la petición sale como mucho cada REFRESCO_MS y nunca con la pestaña oculta.
    const mirar = () => tocaRefrescar(Date.now(), ultima.current, document.visibilityState === 'visible') && void cargar();
    const reloj = window.setInterval(mirar, 10_000);
    document.addEventListener('visibilitychange', mirar);
    return () => {
      window.clearInterval(reloj);
      document.removeEventListener('visibilitychange', mirar);
    };
  }, [cargar]);

  return { datos, error, cargando, leida, cargar, poner };
}

export default function Agenda({ onConfigurar, notificar }: Props) {
  const { datos, error, cargando, leida, cargar, poner } = useAgenda();
  const [ficha, setFicha] = useState<number | null>(null);
  const acciones = useAccionesAgenda(datos, poner, notificar);

  if (!datos) return error ? <Alert tone="red">{error}</Alert> : <Loading texto="Cargando la agenda del taller…" />;
  const f = datos.estadoFuente;
  const { deFila } = acciones;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-gray-600">
          <strong className="font-semibold text-gray-900">Fuente: {rotuloFuente(datos.fuente.fuente)}</strong> · sincronizada {f.ultimaSincronizacion ? fmtFechaHora(f.ultimaSincronizacion) : 'nunca'} · datos de las{' '}
          {fmtFechaHora(new Date(leida).toISOString()).slice(-5)} · {datos.totalAbiertos} tickets abiertos · se actualiza sola cada {REFRESCO_MS / 60_000} minutos
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {acciones.cabecera}
          <Button variant="ghost" onClick={() => void cargar()} busy={cargando} aria-label="Actualizar la agenda">
            {!cargando && <RefreshCw className="h-4 w-4" aria-hidden />} Actualizar
          </Button>
        </div>
      </div>
      {error && <Alert tone="red">No se pudo actualizar: {error} Se enseña lo último que se leyó.</Alert>}
      {acciones.error && <Alert tone="red">{acciones.error}</Alert>}
      {datos.avisos.map((a) => (
        <Alert key={a.codigo} tone={a.codigo === 'fuente_respaldo' ? 'blue' : 'amber'}>
          {a.mensaje}
          {a.codigo === 'estados_sin_categoria' && <Enlace onClick={onConfigurar}>Ir a Configuración</Enlace>}
        </Alert>
      ))}

      <div className="grid gap-3 sm:grid-cols-3">
        {datos.etapas.map((e) => {
          const r = resumenEtapa(e);
          return (
            <section key={e.etapa} aria-label={`Resumen de ${e.etiqueta}`} className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className={TITULO}>{e.etiqueta}</h3>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-2xl font-semibold tabular-nums text-gray-900">
                  {r.ocupados}/{r.puestos}
                </span>
                <span className="text-sm text-gray-500">puestos</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${SATURACION[r.tono]}`}>{r.saturacion}</span>
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {r.enFila} en la fila · primer hueco: <strong className="font-semibold text-gray-900">{r.primerHueco === datos.hoy ? 'hoy' : fmtFecha(r.primerHueco)}</strong>
              </p>
            </section>
          );
        })}
      </div>

      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="hidden min-w-0 sm:block">
          <GanttAgenda agenda={datos} onTicket={setFicha} accionPuesto={acciones.dePuesto} />
        </div>
        <div className="min-w-0 sm:hidden">
          <ListaDias agenda={datos} onTicket={setFicha} />
        </div>
        <Card title="Filas" hint="Quién espera en cada etapa, en su orden, y cuándo se prevé que entre y termine. La fecha de remisión ordena la primera etapa.">
          <div className="flex flex-col gap-5">
            {datos.etapas.map((e) => (
              <Fila key={e.etapa} agenda={datos} etapa={e} onTicket={setFicha} accion={deFila && ((t) => deFila(e, t))} />
            ))}
          </div>
        </Card>
      </div>

      <Carriles agenda={datos} onTicket={setFicha} onConfigurar={onConfigurar} />
      {ficha !== null && <FichaTicket agenda={datos} numero={ficha} onClose={() => setFicha(null)} acciones={acciones.deFicha(ficha)} />}
      {acciones.dialogos}
    </div>
  );
}

function Enlace({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="ml-1 inline-flex min-h-[44px] items-center font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900 sm:min-h-0">
      {children}
    </button>
  );
}

/** El número de un ticket, que abre su ficha, y su asunto abreviado (como texto). */
function Ticket({ agenda, numero, onTicket }: { agenda: RespuestaAgenda; numero: number; onTicket: AlTicket }) {
  const asunto = detalleDe(agenda, numero)?.asunto;
  return (
    <button type="button" onClick={() => onTicket(numero)} title={asunto ?? undefined} className="inline-flex min-h-[44px] min-w-0 max-w-full items-center gap-2 rounded-lg px-1 text-left hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
      <span className="font-mono font-semibold text-blue-700 underline underline-offset-2">{numero}</span>
      {asunto && <span className="truncate text-gray-600">{asunto}</span>}
    </button>
  );
}

/** La fila de una etapa, en su orden. `accion` (lote 7b) es lo que se puede hacer con cada ticket. */
export function Fila({ agenda, etapa, onTicket, accion }: { agenda: RespuestaAgenda; etapa: EtapaProyectada; onTicket: AlTicket; accion?: (t: TicketEnFila) => ReactNode }) {
  return (
    <section aria-label={`Fila de ${etapa.etiqueta}`}>
      <h3 className={TITULO}>
        {etapa.etiqueta} · {etapa.fila.length} en la fila
      </h3>
      {etapa.fila.length === 0 ? (
        <p className="mt-1 text-sm text-gray-500">Nadie espera.</p>
      ) : (
        <div className="mt-1 max-h-[34rem] overflow-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="sticky top-0 z-[1] bg-white">
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className={TH}>N.º</th>
                <th className={TH}>Ticket · asunto</th>
                <th className={TH}>Remisión</th>
                <th className={TH}>Entra</th>
                <th className={TH}>Termina</th>
                {accion && <th className={TH} />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {etapa.fila.map((t) => (
                <tr key={t.numero}>
                  <td className="px-2 py-1 tabular-nums text-gray-500">{t.posicion}</td>
                  <td className="max-w-[16rem] px-2 py-1">
                    <Ticket agenda={agenda} numero={t.numero} onTicket={onTicket} />
                    <span className="flex flex-wrap gap-1 pl-1">
                      {marcasDeFila(t).map((m) => (
                        <span key={m.texto} title={m.ayuda}>
                          <Tag tone={m.tono}>{m.texto}</Tag>
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">{fmtFecha(detalleDe(agenda, t.numero)?.remisionEntrada)}</td>
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-900" title={t.puestoPrevisto ? `Previsto en el puesto ${t.puestoPrevisto}` : undefined}>
                    {fmtFecha(t.entradaPrevista)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums text-gray-600">{fmtFecha(t.finPrevisto)}</td>
                  {accion && <td className="px-2 py-1 text-right">{accion(t)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Lo que no está en ningún puesto ni fila: standby, por llegar, equipos nuevos encadenados, recuentos y estados sin categoría. */
function Carriles({ agenda, onTicket, onConfigurar }: { agenda: RespuestaAgenda; onTicket: AlTicket; onConfigurar: () => void }) {
  const encadenados = agenda.etapas.flatMap((e) => e.encadenados.map((t) => ({ ...t, etiqueta: e.etiqueta })));
  const lista = 'mt-1 grid gap-x-4 sm:grid-cols-2 xl:grid-cols-3';
  return (
    <Card title="Fuera de los puestos" hint="No ocupan puesto ni se les prevé fecha.">
      <div className="flex flex-col gap-4 text-sm">
        <section aria-label="En espera (standby)">
          <h3 className={TITULO}>En espera (standby) · {agenda.standby.length}</h3>
          {agenda.standby.length === 0 && <p className="mt-1 text-gray-500">Ninguno.</p>}
          <ul className={lista}>
            {agenda.standby.map((t) => (
              <li key={t.numero} className="flex min-w-0 flex-wrap items-center gap-x-2 border-b border-gray-100">
                <Ticket agenda={agenda} numero={t.numero} onTicket={onTicket} />
                <span className="text-xs text-gray-500">
                  {t.estado} · {diasEnEstado(detalleDe(agenda, t.numero), agenda.hoy)}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="Por llegar">
          <h3 className={TITULO}>Por llegar · {agenda.porLlegar.length}</h3>
          {agenda.porLlegar.length === 0 && <p className="mt-1 text-gray-500">Ninguno.</p>}
          <ul className={lista}>
            {agenda.porLlegar.map((t) => (
              <li key={t.numero} className="flex min-w-0 flex-wrap items-center gap-x-2 border-b border-gray-100">
                <Ticket agenda={agenda} numero={t.numero} onTicket={onTicket} />
                <span className="text-xs text-gray-500">{t.estado}</span>
              </li>
            ))}
          </ul>
        </section>
        {encadenados.length > 0 && (
          <section aria-label="Equipos nuevos encadenados">
            <h3 className={TITULO}>Equipos nuevos que llegarán de la etapa anterior · {encadenados.length}</h3>
            <ul className={lista}>
              {encadenados.map((t) => (
                <li key={t.numero} className="flex min-w-0 flex-wrap items-center gap-x-2 border-b border-gray-100">
                  <Ticket agenda={agenda} numero={t.numero} onTicket={onTicket} />
                  <span className="text-xs text-gray-500">
                    llegará a {t.etiqueta} el {fmtFecha(t.llegadaPrevista)}
                    {t.entradaPrevista && ` · entraría el ${fmtFecha(t.entradaPrevista)} y acabaría el ${fmtFecha(t.finPrevisto)}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-gray-600">
          Fin de taller: <strong className="font-semibold text-gray-900">{agenda.finTaller}</strong> · Fuera de la agenda: <strong className="font-semibold text-gray-900">{agenda.fueraAgenda}</strong>
        </p>
        {agenda.sinCategoria.length > 0 && (
          <section aria-label="Sin categoría">
            <h3 className={`${TITULO} text-amber-800`}>Sin categoría · {agenda.sinCategoria.reduce((n, g) => n + g.tickets.length, 0)}</h3>
            <ul className="mt-1">
              {agenda.sinCategoria.map((g) => (
                <li key={g.clave} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium text-gray-900">«{g.estado}»:</span>
                  {g.tickets.map((n) => (
                    <Ticket key={n} agenda={agenda} numero={n} onTicket={onTicket} />
                  ))}
                </li>
              ))}
            </ul>
            <p className="text-gray-600">
              Sus tickets no entran en ninguna fila hasta que el estado tenga categoría.<Enlace onClick={onConfigurar}>Clasificarlos en Configuración</Enlace>
            </p>
          </section>
        )}
      </div>
    </Card>
  );
}

/** La ficha lateral de un ticket: lo que la agenda sabe de él. `acciones` (lote 7b) va al pie. */
export function FichaTicket({ agenda, numero, onClose, acciones }: { agenda: RespuestaAgenda; numero: number; onClose: () => void; acciones?: ReactNode }) {
  const d = detalleDe(agenda, numero);
  const s = situacionDe(agenda, numero);
  const cadena = encadenadoDe(agenda, numero);
  const p = s.donde === 'puesto' ? s.puesto : null;
  const marcas = [
    ...(s.donde === 'fila' ? marcasDeFila(s.fila).map((m) => m.texto) : []),
    ...(p?.pasadoDeFecha ? ['pasado de fecha'] : []),
    ...(p?.ocupante?.marcas.sinTipo ? ['sin tipo'] : []),
    ...(p?.ocupante?.marcas.sinDuracion ? ['sin duración'] : []),
    ...(p?.ocupante?.marcas.sinDatosFuente ? ['sin datos de la fuente'] : []),
    ...(p?.aExtinguir ? ['puesto a extinguir'] : []),
  ];
  const donde = { puesto: 'Ocupa un puesto', fila: 'En la fila', standby: 'En espera (standby)', por_llegar: 'Por llegar', sin_categoria: 'Estado sin categoría', otro: 'Fuera de los puestos y las filas' }[s.donde];
  const filas: [string, ReactNode][] = [
    ['Estado', d?.estado ?? p?.ocupante?.estado ?? 'La fuente no trae este ticket'],
    ['Tipo de servicio', d?.tipo ? `${d.tipo}${d.tipoManual ? ' · puesto a mano' : ''}` : 'Sin tipo'],
    ['Flujo', d ? textoFlujo(d) : '—'],
    ['Fecha de remisión', d?.remisionEntrada ? fmtFecha(d.remisionEntrada) : 'Falta: se escribe en Zoho Desk'],
    ['En la agenda', donde],
    ['Etapa', s.donde === 'puesto' || s.donde === 'fila' ? s.etiqueta : '—'],
    ['Puesto', p ? `Puesto ${p.puesto}` : s.donde === 'fila' ? `N.º ${s.fila.posicion} de la fila${s.fila.puestoPrevisto ? ` · previsto en el puesto ${s.fila.puestoPrevisto}` : ''}` : '—'],
    ['Desde', p ? fmtFecha(p.inicio) : s.donde === 'fila' ? `entraría el ${fmtFecha(s.fila.entradaPrevista)}` : '—'],
    ['Fin estimado', p ? (p.pasadoDeFecha ? `${fmtFecha(p.finEstimado)} (debía acabar el ${fmtFecha(p.finPlanificado)})` : fmtFecha(p.finEstimado)) : s.donde === 'fila' ? fmtFecha(s.fila.finPrevisto) : '—'],
    ...(cadena ? ([['Después', `Llegará a ${cadena.etiqueta} el ${fmtFecha(cadena.llegadaPrevista)}`]] as [string, ReactNode][]) : []),
    ['Marcas', marcas.length ? marcas.join(' · ') : 'Ninguna'],
    ['Última transición conocida', d ? textoTransicion(d) : '—'],
  ];
  return (
    <Drawer title={`Ticket ${numero}`} subtitle={d?.asunto ?? 'Sin asunto'} onClose={onClose}>
      <dl className="divide-y divide-gray-100 text-sm">
        {filas.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2 py-2">
            <dt className="text-gray-500">{k}</dt>
            <dd className="break-words text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
      {acciones}
    </Drawer>
  );
}
