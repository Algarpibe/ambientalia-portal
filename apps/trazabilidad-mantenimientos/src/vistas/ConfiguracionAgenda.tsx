import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  ETAPAS_AGENDA,
  ETIQUETA_ETAPA,
  PLAZO_MAX_DIAS,
  PLAZO_MIN_DIAS,
  PUESTOS_MAX,
  TIPO_POR_DEFECTO,
  esCategoriaAgenda,
  esEtapaAgenda,
  type CategoriaAgenda,
  type ConfiguracionAgenda,
  type EstadoDesk,
  type EtapaAgenda,
  type PlazoServicio,
} from '../dominio';
import { OPCIONES_CATEGORIA, avisoCategoria, celdaDuracion, columnasDuraciones, estadosAgenda, firma, leerEntero, sinCategoria, ticketsPorEtapa } from '../lib/agenda';
import { etiquetaTipoDesk } from '../lib/servicios';
import { usePermisos } from '../permisos';
import { Alert, Card, DESACTIVADO, Loading } from '../ui';

/**
 * Configuración de la agenda del taller (lote 6): los puestos de cada etapa,
 * cuántos días hábiles ocupa un puesto cada tipo de servicio y la categoría de
 * cada estado de Desk. Todo se guarda al cambiar y queda firmado. La ve
 * cualquiera con la app; la cambia quien tiene `config.write`.
 */
type Bloque = 'puestos' | 'duraciones' | 'estados';

export interface AgendaConfig {
  config: ConfiguracionAgenda | null;
  /** Los tipos de servicio de «Plazos»: de ahí salen las columnas de las duraciones. */
  plazos: PlazoServicio[];
  /** El último fallo, y en qué bloque se enseña. */
  error: { bloque: Bloque; mensaje: string } | null;
  /** Lo que se está guardando ahora (una clave por casilla o desplegable). */
  guardando: string | null;
  editable: boolean;
  guardar: (bloque: Bloque, clave: string, pedir: () => Promise<ConfiguracionAgenda>, aviso: string) => Promise<void>;
}

/** La configuración de la agenda, cargada una vez para los tres bloques. Los cambios van en fila: cada respuesta trae la configuración entera y no deben pisarse. */
export function useAgendaConfig(notificar: (msg: string) => void): AgendaConfig {
  const [config, setConfig] = useState<ConfiguracionAgenda | null>(null);
  const [plazos, setPlazos] = useState<PlazoServicio[]>([]);
  const [error, setError] = useState<AgendaConfig['error']>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const editable = usePermisos().puede('config.write');
  const cola = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    void (async () => {
      try {
        const [c, p] = await Promise.all([api.configuracionAgenda(), api.plazos()]);
        setConfig(c);
        setPlazos(p.plazos);
      } catch (e) {
        setError({ bloque: 'puestos', mensaje: (e as Error).message });
      }
    })();
  }, []);

  const guardar = useCallback<AgendaConfig['guardar']>(
    (bloque, clave, pedir, aviso) => {
      cola.current = cola.current.then(async () => {
        setGuardando(clave);
        try {
          setConfig(await pedir());
          setError(null);
          notificar(aviso);
        } catch (e) {
          setError({ bloque, mensaje: `No se pudo guardar: ${(e as Error).message}` });
        } finally {
          setGuardando(null);
        }
      });
      return cola.current;
    },
    [notificar],
  );

  return { config, plazos, error, guardando, editable, guardar };
}

function ErrorDe({ agenda, bloque }: { agenda: AgendaConfig; bloque: Bloque }) {
  if (agenda.error?.bloque !== bloque) return null;
  return (
    <div className="mb-3">
      <Alert tone="red">{agenda.error.mensaje}</Alert>
    </div>
  );
}

const SELECT = `min-h-[36px] rounded-xl border bg-white px-2 py-1 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO}`;
const TH = 'px-3 py-2 font-semibold';
const CABECERA = 'border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500';
const dias = (n: number) => `${n} día${n === 1 ? '' : 's'} hábil${n === 1 ? '' : 'es'}`;

/**
 * Una casilla numérica que guarda al salir de ella (o con Intro) si lo escrito
 * vale y ha cambiado; Escape lo deshace. Vacía enseña en gris lo que hereda.
 */
function Casilla(p: {
  valor: number | null;
  heredado?: number | null;
  rango: { min: number; max: number; vacio: boolean };
  disabled: boolean;
  etiqueta: string;
  nota?: string;
  onGuardar: (valor: number | null) => Promise<void>;
}) {
  const [txt, setTxt] = useState<string | null>(null);
  const escrito = txt ?? (p.valor === null ? '' : String(p.valor));
  const leido = leerEntero(escrito, p.rango);
  const mal = txt !== null && 'error' in leido;
  const confirmar = () => {
    if (txt === null || 'error' in leido) return;
    if (leido.valor === p.valor) return setTxt(null);
    void p.onGuardar(leido.valor).finally(() => setTxt(null));
  };
  return (
    <span className="inline-block">
      <input
        type="number"
        inputMode="numeric"
        min={p.rango.min}
        max={p.rango.max}
        step={1}
        value={escrito}
        placeholder={p.heredado === null || p.heredado === undefined ? '' : String(p.heredado)}
        disabled={p.disabled}
        aria-label={p.etiqueta}
        aria-invalid={mal}
        title={p.nota}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setTxt(null);
        }}
        className={`block min-h-[44px] w-20 rounded-xl border bg-white px-3 py-2 text-sm tabular-nums text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 ${DESACTIVADO} ${
          mal ? 'border-red-400 focus:ring-red-100' : 'border-gray-300 focus:border-blue-400 focus:ring-blue-100'
        }`}
      />
      {mal && <span className="mt-1 block max-w-[9rem] text-xs text-red-600">{leido.error}</span>}
    </span>
  );
}

/** Cuántos equipos puede atender a la vez cada etapa, y cuántos tickets tiene hoy. */
export function PuestosAgenda({ agenda }: { agenda: AgendaConfig }) {
  const { config, editable, guardar } = agenda;
  const enEtapa = ticketsPorEtapa(config?.estados ?? []);
  return (
    <Card
      title="Agenda del taller · Puestos"
      hint={`Cuántos equipos puede atender a la vez cada etapa (de 0 a ${PUESTOS_MAX}). Se guarda al salir de la casilla. Bajar los puestos no desaloja a nadie: los que sobran dejan de recibir equipos cuando se vacían.`}
      className="max-w-4xl"
    >
      <ErrorDe agenda={agenda} bloque="puestos" />
      {!config ? (
        !agenda.error && <Loading texto="Cargando la configuración de la agenda…" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className={CABECERA}>
                <th className={TH}>Etapa</th>
                <th className={TH}>Puestos</th>
                <th className={`${TH} text-right`}>Tickets en la etapa hoy</th>
                <th className={TH}>Último cambio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {config.etapas.map((e) => (
                <tr key={e.etapa}>
                  <td className="px-3 py-2 font-medium text-gray-900">{e.etiqueta}</td>
                  <td className="px-3 py-2">
                    <Casilla
                      valor={e.puestos}
                      rango={{ min: 0, max: PUESTOS_MAX, vacio: false }}
                      disabled={!editable}
                      etiqueta={`Puestos de ${e.etiqueta}`}
                      onGuardar={(n) => guardar('puestos', `puestos:${e.etapa}`, () => api.guardarPuestos(e.etapa, n ?? 0), `${e.etiqueta}: ${n} puesto${n === 1 ? '' : 's'}`)}
                    />
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${enEtapa[e.etapa] > e.puestos ? 'font-semibold text-amber-700' : 'text-gray-600'}`}
                    title="Tickets abiertos que están ahora en un estado de esta etapa, tengan puesto o no"
                  >
                    {enEtapa[e.etapa]}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{firma(e.actualizadoPor, e.actualizadoEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Cuántos días hábiles ocupa un puesto de cada etapa un servicio de cada tipo. Vacía = la «*» de la etapa. */
export function DuracionesAgenda({ agenda }: { agenda: AgendaConfig }) {
  const { config, plazos, editable, guardar } = agenda;
  if (!config) return null;
  const columnas = columnasDuraciones(plazos, config.tiposAbiertos, config.duraciones);
  return (
    <Card
      title="Duraciones (días hábiles)"
      hint="Cuánto ocupa un puesto de cada etapa un servicio, según su tipo. La columna «*» es la de por defecto: una casilla vacía usa ese valor (se ve en gris). Escribir en una casilla le da duración propia a ese tipo; vaciarla se la quita. La «*» no se puede vaciar."
    >
      <ErrorDe agenda={agenda} bloque="duraciones" />
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className={CABECERA}>
              <th className={TH}>Etapa</th>
              {columnas.map((c) => (
                <th key={c.tipo} className={`${TH} max-w-[7rem] align-bottom normal-case`} title={c.nota || undefined}>
                  {c.tipo === TIPO_POR_DEFECTO ? '* por defecto' : c.etiqueta}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {config.etapas.map((e) => (
              <tr key={e.etapa}>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">{e.etiqueta}</td>
                {columnas.map((c) => {
                  const { propia, heredada } = celdaDuracion(config.duraciones, e.etapa, c.tipo);
                  const defecto = c.tipo === TIPO_POR_DEFECTO;
                  const de = `${e.etiqueta}${defecto ? ', por defecto' : ` · ${c.etiqueta}`}`;
                  return (
                    <td key={c.tipo} className={`px-3 py-2 align-top ${defecto ? 'bg-gray-50' : ''}`}>
                      <Casilla
                        valor={propia?.dias ?? null}
                        heredado={heredada}
                        rango={{ min: PLAZO_MIN_DIAS, max: PLAZO_MAX_DIAS, vacio: !defecto }}
                        disabled={!editable}
                        etiqueta={`Duración de ${de}, en días hábiles`}
                        nota={propia ? `${dias(propia.dias)} · ${firma(propia.actualizadoPor, propia.actualizadoEn)}` : heredada === null ? 'Sin duración' : `Usa la de por defecto: ${dias(heredada)}`}
                        onGuardar={(n) =>
                          guardar('duraciones', `duracion:${e.etapa}:${c.tipo}`, () => api.guardarDuracion(e.etapa, c.tipo, n), n === null ? `${de}: usa la de por defecto` : `${de}: ${dias(n)}`)
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        No es el plazo comprometido con el cliente (el de «Plazos por tipo de servicio»): es lo que un equipo ocupa un puesto. Las columnas son los tipos de servicio de los plazos y los
        que traen los tickets abiertos. Pasa el ratón por una casilla para ver quién la cambió y cuándo.
      </p>
    </Card>
  );
}

/**
 * Qué es cada estado de Desk para la agenda: su categoría y, si es una etapa
 * activa, cuál. No es el rol del reloj (el bloque de al lado): son dos ajustes
 * con dos firmas y ninguno cambia al otro. Elegir «Etapa activa» no guarda
 * hasta que se elige la etapa: una sin la otra no vale.
 */
export function CategoriasAgenda({ agenda }: { agenda: AgendaConfig }) {
  const { config, editable, guardando, guardar } = agenda;
  const [soloConTickets, setSoloConTickets] = useState(true);
  /** El estado al que se le ha elegido «Etapa activa» y aún no su etapa. */
  const [pendiente, setPendiente] = useState<string | null>(null);
  if (!config) return null;
  const faltan = sinCategoria(config.estados);
  const filas = estadosAgenda(config.estados, soloConTickets);

  const cambiar = (e: EstadoDesk, categoria: CategoriaAgenda, etapa: EtapaAgenda | null) => {
    setPendiente(null);
    void guardar('estados', `estado:${e.clave}`, () => api.guardarCategoria(e.etiqueta, categoria, etapa), avisoCategoria(e.etiqueta, categoria, etapa));
  };

  return (
    <Card
      title="Estados de Desk → agenda"
      hint="La categoría de cada estado en la agenda del taller: si el ticket ocupa un puesto (etapa activa), espera en la fila, está en standby o ya terminó. El desplegable guarda al momento."
      actions={
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="h-5 w-5 accent-blue-600" checked={soloConTickets} onChange={(ev) => setSoloConTickets(ev.target.checked)} />
          Sólo estados con tickets
        </label>
      }
    >
      <ErrorDe agenda={agenda} bloque="estados" />
      {faltan.length > 0 && (
        <div className="mb-3">
          <Alert tone="amber" title={faltan.length === 1 ? 'Hay un estado sin categoría' : `Hay ${faltan.length} estados sin categoría`}>
            {faltan.map((e) => `«${e.etiqueta}»`).join(', ')}: sus tickets no entran en ninguna fila ni ocupan puesto hasta que se la elijas.
          </Alert>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] text-sm">
          <thead>
            <tr className={CABECERA}>
              <th className={TH}>Estado en Desk</th>
              <th className={`${TH} text-right`} title="Tickets abiertos que están ahora en este estado, según la fuente de la agenda">
                Tickets
              </th>
              {/* Ancho para los dos desplegables en una línea; si no cabe, la etapa baja a la siguiente. */}
              <th className={`${TH} w-[302px]`}>Categoría y etapa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.map((e) => {
              const categoria = pendiente === e.clave ? 'activa' : (e.categoria ?? '');
              const etapa = pendiente === e.clave ? '' : (e.etapa ?? '');
              const tipo = etiquetaTipoDesk(e.tipoDesk);
              return (
                <tr key={e.clave} className={e.categoria === null ? 'bg-amber-50' : ''}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-gray-900">{e.etiqueta}</span>
                    {tipo && <span className="ml-2 text-xs text-gray-400">{tipo}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{e.ticketsAbiertos}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <select
                        value={categoria}
                        disabled={!editable}
                        aria-busy={guardando === `estado:${e.clave}`}
                        aria-label={`${e.etiqueta}: categoría en la agenda`}
                        title={OPCIONES_CATEGORIA.find((o) => o.valor === categoria)?.ayuda ?? 'Sin categoría: no sale en la agenda'}
                        onChange={(ev) => {
                          const c = ev.target.value;
                          if (!esCategoriaAgenda(c)) return;
                          // Volver a la que ya tenía no es un cambio: no se guarda ni se vuelve a firmar.
                          if (c === e.categoria) setPendiente(null);
                          else if (c === 'activa') setPendiente(e.clave);
                          else cambiar(e, c, null);
                        }}
                        className={`${SELECT} w-[150px] ${categoria === '' ? 'border-amber-400 text-amber-800' : 'border-gray-300 text-gray-900'}`}
                      >
                        {categoria === '' && <option value="">Sin categoría…</option>}
                        {OPCIONES_CATEGORIA.map((o) => (
                          <option key={o.valor} value={o.valor} title={o.ayuda}>
                            {o.texto}
                          </option>
                        ))}
                      </select>
                      {categoria === 'activa' && (
                        <select
                          value={etapa}
                          disabled={!editable}
                          aria-label={`${e.etiqueta}: etapa del taller`}
                          onChange={(ev) => esEtapaAgenda(ev.target.value) && cambiar(e, 'activa', ev.target.value)}
                          className={`${SELECT} w-[120px] ${etapa === '' ? 'border-amber-400 text-amber-800' : 'border-gray-300 text-gray-900'}`}
                        >
                          {etapa === '' && <option value="">Elige la etapa…</option>}
                          {ETAPAS_AGENDA.map((x) => (
                            <option key={x} value={x}>
                              {ETIQUETA_ETAPA[x]}
                            </option>
                          ))}
                        </select>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-gray-500" role={guardando === `estado:${e.clave}` ? 'status' : undefined}>
                      {guardando === `estado:${e.clave}`
                        ? 'guardando…'
                        : pendiente === e.clave
                          ? 'Elige la etapa para guardar.'
                          : e.categoria === null
                            ? 'Nadie le ha dado categoría.'
                            : firma(e.categoriaPor, e.categoriaEn, 'propuesta inicial')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        {soloConTickets ? `Se enseñan ${filas.length} de ${config.estados.length} estados: los que hoy tienen tickets abiertos. ` : ''}
        Los tickets abiertos se cuentan en la fuente de la agenda (Desk 2.0, o la réplica de respaldo), así que pueden no coincidir con los del reloj. Debajo de cada categoría va quién la
        eligió y cuándo; «semilla» es la propuesta de partida.
      </p>
    </Card>
  );
}
