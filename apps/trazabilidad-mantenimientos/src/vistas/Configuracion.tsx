import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { PLAZO_MAX_DIAS, PLAZO_MIN_DIAS, esRolEstado, type EstadoDesk, type PlazoServicio, type RolEstado } from '../dominio';
import { estadosReloj, firma } from '../lib/agenda';
import { OPCIONES_ROL, avisoRol, etiquetaTipoDesk, notaDerivado, notaEstadoDesk } from '../lib/servicios';
import { fmtFecha } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, Card, DESACTIVADO, Loading } from '../ui';
import { CategoriasAgenda, DuracionesAgenda, PuestosAgenda, useAgendaConfig } from './ConfiguracionAgenda';
import OrigenDatos from './OrigenDatos';

/**
 * Configuración. Primer bloque: el plazo, en días hábiles, de cada tipo de servicio de Zoho
 * Desk. Con él se calcula la fecha límite de la pestaña «Servicios» (ingreso +
 * plazo). Vacío = ese tipo no tiene plazo. La ve cualquiera con la app; la
 * edita quien tiene el permiso `config.write` (el Director Técnico y los
 * administradores del portal) y cada cambio queda firmado con su correo. Un tipo compuesto (`derivadoDe`) va
 * en sólo lectura: su plazo es la suma de los de sus partes. Segundo bloque: el
 * rol de cada estado de Desk en el reloj de ese plazo.
 */
interface Props {
  notificar: (msg: string) => void;
}

/**
 * Cada bloque con su carga y sus errores (si uno falla, los demás siguen): los
 * plazos por tipo de servicio; la agenda del taller (puestos y duraciones,
 * `ConfiguracionAgenda.tsx`); y, uno junto al otro, lo que cada estado de Desk
 * es para el reloj del plazo y para la agenda, que son dos ajustes distintos.
 */
export default function Configuracion({ notificar }: Props) {
  const { puede, motivo } = usePermisos();
  const agenda = useAgendaConfig(notificar);
  return (
    <div className="flex flex-col gap-4">
      {!puede('config.write') && (
        <Alert tone="blue" title="Configuración en modo de consulta">
          La cambia el Director Técnico. {motivo}
        </Alert>
      )}
      <Plazos notificar={notificar} />
      <PuestosAgenda agenda={agenda} />
      <DuracionesAgenda agenda={agenda} />
      <div>
        <h2 className="text-base font-semibold text-gray-900">Estados de Desk</h2>
        <p className="mt-0.5 text-sm text-gray-600">
          El reloj mide el plazo del ticket; la categoría decide si ocupa un puesto en la agenda. Son dos ajustes distintos, cada uno con su firma: cambiar uno no toca el otro.
        </p>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[9fr_11fr]">
        <EstadosDesk notificar={notificar} />
        <CategoriasAgenda agenda={agenda} />
      </div>
      {/* No es un ajuste: de dónde salen los datos de la app. Sólo lectura, para cualquiera. */}
      <OrigenDatos />
    </div>
  );
}

/**
 * Estados de Desk: qué le hace cada uno al reloj del plazo. Tres roles, y sólo
 * uno por estado: «Cuenta» (el de partida: el tiempo corre), «Standby» (reloj
 * en pausa: el ticket depende de una decisión del cliente o de un servicio
 * externo) y «Trabajo terminado» (reloj parado: el trabajo técnico está hecho
 * y el ticket se juzga por el día en que llegó ahí).
 * Salen todos los estados que existen en Desk (y los ya guardados aunque ningún
 * ticket los tenga); ninguno viene marcado: el «En espera» de Desk sólo orienta.
 * El desplegable guarda al momento y queda firmado. El rol no se copia al
 * historial de estados: cambiarlo reevalúa también los días ya pasados.
 */
function EstadosDesk({ notificar }: Props) {
  const [estados, setEstados] = useState<EstadoDesk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Clave del estado que se está guardando. Mientras dura, ningún desplegable admite otro cambio: las respuestas no se pisan. */
  const [guardando, setGuardando] = useState<string | null>(null);
  const editable = usePermisos().puede('config.write');
  const [soloConTickets, setSoloConTickets] = useState(true);
  const filas = estadosReloj(estados ?? [], soloConTickets);

  const cargar = useCallback(async () => {
    try {
      setEstados((await api.estados()).estados);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cambiar = async (e: EstadoDesk, rol: RolEstado) => {
    if (rol === e.rol) return;
    setGuardando(e.clave);
    try {
      setEstados((await api.guardarEstado(e.etiqueta, rol)).estados);
      setError(null);
      notificar(avisoRol(e.etiqueta, rol));
    } catch (err) {
      setError(`No se pudo guardar «${e.etiqueta}»: ${(err as Error).message}`);
    } finally {
      setGuardando(null);
    }
  };

  return (
    <Card
      title="Estados de Desk → reloj del plazo"
      hint="Qué le hace cada estado al reloj del plazo: «Cuenta», el tiempo corre; «Standby», en pausa a la espera del cliente o de un servicio externo (esos días hábiles no cuentan); «Trabajo terminado», parado: el ticket queda cumplido o incumplido según el día en que llegó. El portal mide el tiempo desde que vio cada ticket por primera vez."
      actions={
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="h-5 w-5 accent-blue-600" checked={soloConTickets} onChange={(ev) => setSoloConTickets(ev.target.checked)} />
          Sólo estados con tickets
        </label>
      }
    >
      {error && (
        <div className="mb-3">
          <Alert tone="red">{error}</Alert>
        </div>
      )}
      {!estados ? (
        !error && <Loading texto="Cargando los estados de Desk…" />
      ) : estados.length === 0 ? (
        <p className="text-sm text-gray-500">Todavía no hay ningún estado: Zoho Desk no ha enviado tickets.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">Estado en Desk</th>
                <th className="px-3 py-2 text-right font-semibold" title="Tickets abiertos que están ahora en este estado">
                  Tickets
                </th>
                <th className="px-3 py-2 font-semibold">El tiempo en este estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filas.map((e) => {
                const tipo = etiquetaTipoDesk(e.tipoDesk);
                return (
                  <tr key={e.clave}>
                    <td className="px-3 py-2">
                      <span className="font-medium text-gray-900">{e.etiqueta}</span>
                      <span className="ml-2 text-xs text-gray-400" title={tipo ? 'Tipo de estado según Zoho Desk: sólo orienta' : 'Ningún ticket tiene ahora este estado'}>
                        {tipo || 'sin tickets'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{e.ticketsAbiertos}</td>
                    <td className="px-3 py-1">
                      <span className="inline-flex min-h-[44px] items-center gap-2">
                        <select
                          value={e.rol}
                          disabled={guardando !== null || !editable}
                          aria-busy={guardando === e.clave}
                          aria-label={`${e.etiqueta}: qué hace el tiempo en este estado`}
                          title={notaEstadoDesk(e)}
                          onChange={(ev) => {
                            const rol = ev.target.value;
                            if (esRolEstado(rol)) void cambiar(e, rol);
                          }}
                          className={`min-h-[36px] w-[172px] rounded-xl border bg-white px-2 py-1 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO} ${
                            e.rol === 'cuenta' ? 'border-gray-300 text-gray-500' : 'border-gray-400 font-medium text-gray-900'
                          }`}
                        >
                          {OPCIONES_ROL.map((o) => (
                            <option key={o.valor} value={o.valor} title={o.ayuda}>
                              {o.texto}
                            </option>
                          ))}
                        </select>
                        {guardando === e.clave && (
                          <span className="text-xs text-gray-500" role="status">
                            guardando…
                          </span>
                        )}
                      </span>
                      {/* La firma del ROL (la de la categoría va en el bloque de al lado y es otra). */}
                      <span className="mb-1 block text-xs text-gray-500">{firma(e.actualizadoPor, e.actualizadoEn, 'nadie lo ha cambiado')}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">
        {soloConTickets && estados ? `Se enseñan ${filas.length} de ${estados.length} estados: los que hoy tienen tickets abiertos. ` : ''}
        Sin el filtro salen todos los estados que existen en Zoho Desk, también los cerrados; el tipo que acompaña a cada uno es el de Desk y sólo orienta: todos empiezan en «Cuenta» (un
        estado puede estar «En espera» en Desk sin depender del cliente). El desplegable guarda al momento, y el cambio vale también hacia atrás. Lo anterior a la primera
        vez que el portal vio un ticket no se puede saber y cuenta como tiempo normal.
      </p>
    </Card>
  );
}

/** Los plazos, en días hábiles, de cada tipo de servicio. */
function Plazos({ notificar }: Props) {
  const [plazos, setPlazos] = useState<PlazoServicio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Lo que hay escrito en cada casilla que se ha tocado, por clave. */
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const editable = usePermisos().puede('config.write');

  const cargar = useCallback(async () => {
    try {
      setPlazos((await api.plazos()).plazos);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!plazos) return error ? <Alert tone="red">{error}</Alert> : <Loading texto="Cargando los plazos…" />;

  const escrito = (p: PlazoServicio) => borrador[p.clave] ?? (p.dias === null ? '' : String(p.dias));
  /** El valor a guardar, o un mensaje si lo escrito no vale. La misma regla que valida el servidor. */
  const leer = (txt: string): { dias: number | null } | { error: string } => {
    const t = txt.trim();
    if (t === '') return { dias: null };
    const n = Number(t);
    if (!/^\d+$/.test(t) || n < PLAZO_MIN_DIAS || n > PLAZO_MAX_DIAS) return { error: `Un número entero entre ${PLAZO_MIN_DIAS} y ${PLAZO_MAX_DIAS}, o vacío.` };
    return { dias: n };
  };

  const guardar = async (p: PlazoServicio) => {
    const v = leer(escrito(p));
    if ('error' in v) return;
    setGuardando(p.clave);
    try {
      setPlazos((await api.guardarPlazo(p.etiqueta, v.dias)).plazos);
      setBorrador((b) => {
        const resto = { ...b };
        delete resto[p.clave];
        return resto;
      });
      setError(null);
      notificar(v.dias === null ? `${p.etiqueta}: sin plazo` : `${p.etiqueta}: ${v.dias} día${v.dias === 1 ? '' : 's'} hábil${v.dias === 1 ? '' : 'es'}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  };

  return (
    <Card
      title="Plazos por tipo de servicio"
      hint="Días hábiles (lunes a viernes, sin festivos de Colombia) desde el ingreso del equipo; el día de ingreso no cuenta. Cada servicio usa el plazo de su tipo. Vacío = sin plazo."
    >
      {error && (
        <div className="mb-3">
          <Alert tone="red">{error}</Alert>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 font-semibold">Tipo de servicio</th>
              <th className="px-3 py-2 font-semibold">Plazo (días hábiles)</th>
              <th className="px-3 py-2 text-right font-semibold">Tickets abiertos</th>
              <th className="px-3 py-2 font-semibold">Último cambio</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {plazos.map((p) => {
              // Tipo compuesto («Diagnóstico + Calibración»): su plazo es la suma de sus partes. Se enseña, no se edita.
              const derivado = notaDerivado(p);
              if (derivado) {
                return (
                  <tr key={p.clave}>
                    <td className="px-3 py-2 font-medium text-gray-900">{p.etiqueta}</td>
                    <td className="px-3 py-2">
                      <p className={`flex min-h-[44px] items-center text-sm tabular-nums ${derivado.falta ? 'text-gray-400' : 'font-semibold text-gray-900'}`}>{derivado.valor}</p>
                      <p className={`text-xs ${derivado.falta ? 'text-amber-700' : 'text-gray-500'}`}>{derivado.nota}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.ticketsAbiertos}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">se calcula solo</td>
                    <td className="px-3 py-2" />
                  </tr>
                );
              }
              const txt = escrito(p);
              const v = leer(txt);
              const mal = 'error' in v;
              const cambiado = !mal && v.dias !== p.dias;
              return (
                <tr key={p.clave}>
                  <td className="px-3 py-2 font-medium text-gray-900">{p.etiqueta}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={PLAZO_MIN_DIAS}
                      max={PLAZO_MAX_DIAS}
                      step={1}
                      value={txt}
                      disabled={!editable}
                      onChange={(e) => setBorrador((b) => ({ ...b, [p.clave]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && cambiado && void guardar(p)}
                      placeholder="sin plazo"
                      aria-label={`Plazo de ${p.etiqueta} en días hábiles`}
                      aria-invalid={mal}
                      className={`block min-h-[44px] w-32 rounded-xl border bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 ${DESACTIVADO} ${
                        mal ? 'border-red-400 focus:ring-red-100' : 'border-gray-300 focus:border-blue-400 focus:ring-blue-100'
                      }`}
                    />
                    {mal && <p className="mt-1 text-xs text-red-600">{v.error}</p>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.ticketsAbiertos}</td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {p.actualizadoPor ? (
                      <>
                        {p.actualizadoPor} · {fmtFecha(p.actualizadoEn)}
                      </>
                    ) : (
                      <span className="text-gray-400">{p.dias === null ? 'sin configurar' : 'valor inicial'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editable && (
                      <Button variant="primary" disabled={!cambiado} busy={guardando === p.clave} onClick={() => void guardar(p)}>
                        Guardar
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Los tipos salen de Zoho Desk: si un ticket abierto trae uno nuevo, aparece aquí sin plazo para que se lo pongas. Los plazos no se suman entre sí: un equipo en
        calibración tiene el plazo de «Calibración», no el de diagnóstico más el de calibración. La excepción es el tipo «Diagnóstico + Calibración», para el equipo que
        pasa por las dos cosas: su plazo es la suma de los otros dos, se recalcula solo cuando cambias cualquiera de ellos y por eso no se edita aquí.
      </p>
    </Card>
  );
}
