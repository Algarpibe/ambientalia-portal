import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api';
import { ESTADOS, ETIQUETA_ESTADO, type EquipoVista, type FilaHoja, type RespuestaHoja } from '../dominio';
import { AVISO_CORTO, ETIQUETA_AVISO, ETIQUETA_SITUACION, FILTRO_HOJA_VACIO, NOTA_SITUACION, ORDEN_HOJA, accionRetiro, textoRetiro, etiquetaMarca, filtrarHoja, hayFiltroHoja, ordenarHoja, origenFecha, porSituacion, textoContador, valorEnHoja, type ColumnaHoja, type FiltroHoja, type OrdenHoja } from '../lib/hoja';
import { fmtFecha, textoVigencia } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, Card, Drawer, EstadoBadge, Loading, TONO, Tag } from '../ui';
import CalibracionesLista from './CalibracionesLista';
import { Chip } from './Equipos';
import ExportarHoja from './ExportarHoja';
import Retiro from './Retiro';

/**
 * Pestaña «Trazabilidad F-ST-022» (lote 9d-1): la hoja congelada, de todas las
 * marcas, tal como la entiende hoy el portal. Las seis columnas de la hoja en
 * su orden (la vigencia, recalculada a hoy) más el estado y la situación de
 * cada fila. Todo llega calculado de GET /hoja; aquí sólo se filtra y se
 * ordena (`lib/hoja.ts`).
 *
 * Una fila de un equipo activo del inventario abre su ficha de siempre; las
 * demás (sólo en la hoja, inactivas o —desde el lote 9d-2a— de otra marca,
 * enlazadas con Desk 2.0 fuera de seguimiento), un panel con lo que decía la
 * hoja y sus calibraciones conocidas: sin seguimiento ni avisos. Desde el lote
 * 9d-2b, en la ficha y en el panel se corrige la fecha de calibración (con su
 * permiso); cliente, marca, modelo y serial siguen sin cambiarse aquí. Desde el
 * lote 9e, quien tiene `hoja.exportar` se lleva la hoja entera en un .xlsx
 * (`ExportarHoja`): es una descarga, aquí no se sube nada.
 */
interface Props {
  /** El inventario activo que ya tiene la app: sus filas abren la ficha de equipo. */
  equipos: EquipoVista[];
  /** Cambia cuando se pulsa «Actualizar»: vuelve a pedir la tabla. */
  recarga: number;
  onFicha: (clave: string) => void;
  /** Tras corregir algo desde el panel de una fila: vuelve a pedir el inventario de la app. */
  onCambio: () => Promise<void>;
}

const TD = 'break-words px-2 py-2 align-top';
/** El ancho de cada columna (la tabla es de anchos fijos: cabe entera en un portátil, sin columnas escondidas a la derecha). */
const ANCHOS = ['w-[5%]', 'w-[18%]', 'w-[8%]', 'w-[9%]', 'w-[12%]', 'w-[12%]', 'w-[7%]', 'w-[15%]', 'w-[14%]'];
const DISCRETO = 'block font-sans text-[11px] leading-tight text-gray-400';
/** Una fila retirada a mano (el equipo o la fila): se sigue viendo, apagada. */
const ATENUADA = 'opacity-50';

/** El valor de hoy y, si la hoja decía otra cosa, eso debajo, discreto. */
function Valor({ hoy, hoja }: { hoy: ReactNode; hoja: string | null | undefined }) {
  return (
    <>
      {hoy || <span className="text-gray-300">—</span>}
      {hoja !== undefined && <span className={DISCRETO}>en la hoja: {hoja || '—'}</span>}
    </>
  );
}

/** La situación de una fila: en azul lo que está en seguimiento; lo demás, en gris (el texto puede ocupar dos líneas). */
function Situacion({ f }: { f: FilaHoja }) {
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${f.situacion === 'inventario' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{ETIQUETA_SITUACION[f.situacion]}</span>
  );
}

function Etiquetas({ f }: { f: FilaHoja }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Situacion f={f} />
      {f.retirado && (
        <span title={textoRetiro(f.retirado)}>
          <Tag>Retirado a mano</Tag>
        </span>
      )}
      {f.avisos.map((a) => (
        <span key={a} title={ETIQUETA_AVISO[a]}>
          <Tag tone="amber">{AVISO_CORTO[a]}</Tag>
        </span>
      ))}
    </div>
  );
}

const fechaEnHoja = (f: FilaHoja): string | undefined => ('ultimaCalibracion' in f.enHoja ? fmtFecha(f.enHoja.ultimaCalibracion) : undefined);

const FilaTabla = memo(function FilaTabla({ f, onAbrir }: { f: FilaHoja; onAbrir: (f: FilaHoja) => void }) {
  return (
    <tr tabIndex={0} onClick={() => onAbrir(f)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(f)} className={`cursor-pointer hover:bg-gray-50 focus:bg-blue-50 focus:outline-none ${f.retirado ? ATENUADA : ''}`}>
      <td className={`${TD} tabular-nums text-gray-400`}>{f.fila ?? '—'}</td>
      <td className={`${TD} text-gray-900`}>
        <Valor hoy={f.cliente} hoja={f.enHoja.cliente} />
      </td>
      <td className={`${TD} text-gray-600`}>
        <Valor hoy={f.marca} hoja={f.enHoja.marca} />
      </td>
      <td className={`${TD} text-gray-600`}>
        <Valor hoy={f.modelo} hoja={f.enHoja.modelo} />
      </td>
      <td className={`${TD} break-all font-mono text-[13px]`}>
        <Valor hoy={f.serial} hoja={f.enHoja.serial} />
      </td>
      <td className={`${TD} tabular-nums`}>
        <Valor hoy={f.ultimaCalibracion && fmtFecha(f.ultimaCalibracion)} hoja={fechaEnHoja(f)} />
        {f.ultimaCalibracion && <span className={`${DISCRETO} text-gray-500`}>{origenFecha(f)}</span>}
      </td>
      <td className={`${TD} whitespace-nowrap text-right font-semibold tabular-nums ${TONO[f.estado].text}`}>{f.vigenciaDias ?? '—'}</td>
      <td className={`${TD} whitespace-nowrap`}>
        <EstadoBadge estado={f.estado} />
      </td>
      <td className={TD}>
        <Etiquetas f={f} />
      </td>
    </tr>
  );
});

/** La misma fila donde la tabla no cabe (teléfono, tableta, ventana estrecha): una tarjeta que no se desborda. */
const FilaMovil = memo(function FilaMovil({ f, onAbrir }: { f: FilaHoja; onAbrir: (f: FilaHoja) => void }) {
  const distinto = (['cliente', 'marca', 'modelo', 'serial'] as const).filter((k) => f.enHoja[k] !== undefined).map((k) => `${k} «${f.enHoja[k]}»`);
  return (
    <li className="min-w-0">
      <button type="button" onClick={() => onAbrir(f)} className={`flex h-full w-full min-w-0 flex-col gap-1.5 rounded-2xl border border-gray-200 bg-white p-3 text-left text-sm shadow-sm ${f.retirado ? ATENUADA : ''}`}>
        <span className="flex flex-wrap items-center justify-between gap-2">
          <EstadoBadge estado={f.estado} />
          <span className={`text-xs font-semibold tabular-nums ${TONO[f.estado].text}`}>{textoVigencia(f.vigenciaDias)}</span>
        </span>
        <span className="break-words font-medium text-gray-900">{f.cliente || '—'}</span>
        <span className="break-words text-gray-600">
          {f.marca} {f.modelo} · <span className="break-all font-mono text-[13px] text-gray-900">{f.serial || '(sin serial)'}</span>
        </span>
        <span className="text-gray-600">
          Última calibración: <span className="tabular-nums text-gray-900">{fmtFecha(f.ultimaCalibracion)}</span>
          {f.ultimaCalibracion && <> · {origenFecha(f)}</>}
        </span>
        {(distinto.length > 0 || fechaEnHoja(f) !== undefined) && <span className="break-words text-xs text-gray-400">En la hoja: {[...distinto, ...(fechaEnHoja(f) !== undefined ? [`fecha ${fechaEnHoja(f)}`] : [])].join(' · ')}</span>}
        <Etiquetas f={f} />
      </button>
    </li>
  );
});

function Tabla({ filas, onAbrir, orden, onOrden, vacio }: { filas: FilaHoja[]; onAbrir: (f: FilaHoja) => void; orden?: OrdenHoja; onOrden?: (k: ColumnaHoja) => void; vacio: string }) {
  const Th = ({ k, children, right = false }: { k: ColumnaHoja; children: string; right?: boolean }) => (
    <th aria-sort={orden?.k === k ? (orden.dir > 0 ? 'ascending' : 'descending') : undefined} className={`px-2 py-2 align-bottom font-semibold ${right ? 'text-right' : ''}`}>
      {onOrden ? (
        <button type="button" onClick={() => onOrden(k)} className="uppercase tracking-wide hover:text-gray-800">
          {children}
          {orden?.k === k ? (orden.dir > 0 ? ' ↑' : ' ↓') : ''}
        </button>
      ) : (
        <span className="uppercase tracking-wide">{children}</span>
      )}
    </th>
  );
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm xl:block">
        <table className="w-full min-w-[920px] table-fixed text-sm">
          <colgroup>
            {ANCHOS.map((w, i) => (
              <col key={i} className={w} />
            ))}
          </colgroup>
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <Th k="fila">Fila</Th>
              <Th k="cliente">Cliente</Th>
              <Th k="marca">Marca</Th>
              <Th k="modelo">Modelo</Th>
              <Th k="serial">Serial</Th>
              <Th k="ultimaCalibracion">Última calibración</Th>
              <Th k="vigencia" right>
                Vigencia (días)
              </Th>
              <Th k="vigencia">Estado</Th>
              <Th k="situacion">Situación y avisos</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.map((f) => (
              <FilaTabla key={f.fila ?? f.clave} f={f} onAbrir={onAbrir} />
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                  {vacio}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Por debajo de 1280 px la tabla no cabría entera: una tarjeta por fila (en dos columnas si hay sitio). */}
      <ul className="grid gap-2 md:grid-cols-2 xl:hidden">
        {filas.map((f) => (
          <FilaMovil key={f.fila ?? f.clave} f={f} onAbrir={onAbrir} />
        ))}
        {filas.length === 0 && <li className="md:col-span-2 rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">{vacio}</li>}
      </ul>
    </>
  );
}

/**
 * Panel de una fila que no abre ficha de equipo: lo de hoy, lo que decía la hoja y sus calibraciones conocidas. Con
 * `calibraciones.write` se le puede corregir la fecha y anular una calibración (lote 9d-2b), salvo que su serial se
 * repita en la hoja (no se sabría de cuál de las filas es); lo demás sigue en consulta.
 */
function PanelFila({ f, onClose, onCambio }: { f: FilaHoja; onClose: () => void; onCambio: () => Promise<void> }) {
  const { puede } = usePermisos();
  const atribuible = f.clave !== null || (f.fila !== null && !f.avisos.includes('serial_repetido') && !f.avisos.includes('sin_serial'));
  const destino = !atribuible ? null : f.clave !== null ? { clave: f.clave } : { fila: f.fila! };
  const hoy: [string, string][] = [
    ['Última calibración', `${fmtFecha(f.ultimaCalibracion)}${f.ultimaCalibracion ? ` · ${origenFecha(f)}` : ''}`],
    ['Vence', fmtFecha(f.vence)],
    ['Vigencia (días)', f.vigenciaDias === null ? '—' : String(f.vigenciaDias)],
  ];
  const hoja: [string, string][] = [
    ['Cliente', valorEnHoja(f, 'cliente') || '—'],
    ['Marca', valorEnHoja(f, 'marca') || '—'],
    ['Modelo', valorEnHoja(f, 'modelo') || '—'],
    ['Serial', valorEnHoja(f, 'serial') || '—'],
    ['Última calibración', fmtFecha(valorEnHoja(f, 'ultimaCalibracion'))],
  ];
  const Datos = ({ titulo, datos }: { titulo: string; datos: [string, string][] }) => (
    <section className="flex flex-col gap-1.5 border-t border-gray-200 pt-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{titulo}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {datos.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500">{k}</dt>
            <dd className="break-words font-medium tabular-nums text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  return (
    <Drawer onClose={onClose} title={<span className="break-all font-mono">{f.serial || '(sin serial)'}</span>} subtitle={`${f.cliente || '(sin cliente)'} · ${f.marca} ${f.modelo}`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <EstadoBadge estado={f.estado} />
          <span className="text-sm text-gray-500">{textoVigencia(f.vigenciaDias)}</span>
          <Situacion f={f} />
        </div>
        {f.avisos.length > 0 && (
          <Alert tone="amber" title="Conviene mirar">
            <ul className="list-disc pl-4">
              {f.avisos.map((a) => (
                <li key={a}>{ETIQUETA_AVISO[a]}</li>
              ))}
            </ul>
          </Alert>
        )}
        <Datos titulo="Hoy en el portal" datos={hoy} />
        {f.fila === null ? <p className="border-t border-gray-200 pt-4 text-sm text-gray-500">Este equipo no está en la hoja F-ST-022 congelada.</p> : <Datos titulo={`En la hoja F-ST-022 · fila ${f.fila}`} datos={hoja} />}
        <section className="flex flex-col gap-1.5 border-t border-gray-200 pt-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Calibraciones conocidas</p>
          {f.calibraciones.length === 0 && <p className="text-gray-500">{f.ultimaCalibracion ? `Ninguna registrada: vale la fecha del inventario (${fmtFecha(f.ultimaCalibracion)}).` : 'Ninguna.'}</p>}
          <CalibracionesLista items={f.calibraciones} destino={destino} onCambio={onCambio} />
          {!atribuible && puede('calibraciones.write') && <p className="text-xs text-gray-500">No se le puede corregir la fecha: su serial se repite en la hoja (o no tiene), y no se sabría de cuál de las filas es la calibración.</p>}
        </section>
        <Retiro accion={accionRetiro(f)} retirado={f.retirado} onCambio={() => onCambio()} />
        <p className="text-xs text-gray-500">
          {puede('calibraciones.write') ? 'Cliente, marca, modelo y serial no se cambian aquí. ' : 'Sólo lectura. '}
          {NOTA_SITUACION[f.situacion]}
        </p>
        <div>
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      </div>
    </Drawer>
  );
}

/** Una cifra del resumen que, además, filtra. */
function Ficha({ valor, rotulo, nota, activo, onClick }: { valor: number; rotulo: string; nota?: string; activo: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={activo} onClick={onClick} className={`flex min-h-[44px] min-w-0 flex-col rounded-xl border px-3 py-2 text-left transition-colors ${activo ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
      <span className="text-xl font-semibold tabular-nums text-gray-900">{valor}</span>
      <span className="text-xs text-gray-600">{rotulo}</span>
      {nota && <span className="text-[11px] text-gray-400">{nota}</span>}
    </button>
  );
}

export default function HojaFst022({ equipos, recarga, onFicha, onCambio }: Props) {
  const [datos, setDatos] = useState<RespuestaHoja | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroHoja>(FILTRO_HOJA_VACIO);
  const [orden, setOrden] = useState<OrdenHoja>(ORDEN_HOJA);
  /** La fila abierta en el panel, por lo que la identifica: tras un cambio se pinta con lo que devuelva la tabla nueva. */
  const [panel, setPanel] = useState<number | string | null>(null);
  /** Veces que se ha corregido algo desde el panel: con cada una se vuelve a pedir la tabla. */
  const [cambios, setCambios] = useState(0);

  useEffect(() => {
    let vivo = true;
    api.hoja().then(
      (r) => vivo && (setDatos(r), setError(null)),
      (e: Error) => vivo && setError(e.message),
    );
    return () => {
      vivo = false;
    };
  }, [recarga, cambios]);

  // Teclear no espera a que se repinte la tabla: el texto se aplica en cuanto hay hueco.
  const texto = useDeferredValue(filtro.texto);
  const lista = useMemo(() => (datos ? ordenarHoja(filtrarHoja(datos.filas, { ...filtro, texto }), orden) : []), [datos, filtro, texto, orden]);
  const activos = useMemo(() => new Set(equipos.map((e) => e.clave)), [equipos]);
  const abrir = useCallback((f: FilaHoja) => (f.clave !== null && activos.has(f.clave) ? onFicha(f.clave) : setPanel(f.fila ?? f.clave)), [activos, onFicha]);
  const enPanel = panel !== null && datos ? [...datos.filas, ...datos.fueraDeHoja].find((f) => (f.fila ?? f.clave) === panel) : undefined;
  const ordenar = useCallback((k: ColumnaHoja) => setOrden((o) => ({ k, dir: o.k === k ? (-o.dir as 1 | -1) : 1 })), []);

  if (error && !datos) return <Alert tone="red">{error}</Alert>;
  if (!datos) return <Loading texto="Cargando la hoja F-ST-022…" />;

  const r = datos.resumen;
  const enlazadas = porSituacion(datos.filas).enlazado;
  // Lo que no está en la hoja, en dos grupos: lo que está en seguimiento y lo enlazado de otras marcas.
  const fuera: [string, FilaHoja[]][] = [
    ['En el inventario (en seguimiento)', datos.fueraDeHoja.filter((f) => f.situacion !== 'enlazado')],
    ['Enlazados con Desk 2.0 · fuera de seguimiento', datos.fueraDeHoja.filter((f) => f.situacion === 'enlazado')],
  ];
  const set =(p: Partial<FiltroHoja>) => setFiltro((f) => ({ ...f, ...p }));
  const alternar = <T,>(lista: T[], v: T): T[] => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  const c = datos.congelacion;

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="red">{error}</Alert>}
      <Card
        title="Trazabilidad F-ST-022"
        hint={c ? `Hoja «${c.hoja}» congelada el ${fmtFecha(c.en)} desde «${c.archivo}» por ${c.por} · valores a hoy, ${fmtFecha(datos.hoy)} · vigencia de 365 días para todas las marcas` : undefined}
      >
        {datos.motivo && <Alert tone="amber">{datos.motivo}</Alert>}
        {c && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Ficha valor={r.total} rotulo="Equipos en la hoja" nota="todas las marcas" activo={!hayFiltroHoja(filtro)} onClick={() => setFiltro(FILTRO_HOJA_VACIO)} />
            <Ficha valor={r.enInventario} rotulo="En el inventario" nota={`en seguimiento${r.inactivos > 0 ? ` · ${r.inactivos} inactivo${r.inactivos === 1 ? '' : 's'}` : ''}`} activo={filtro.situacion === 'inventario'} onClick={() => set({ situacion: filtro.situacion === 'inventario' ? '' : 'inventario' })} />
            <Ficha valor={enlazadas} rotulo="Enlazados con Desk 2.0" nota="fuera de seguimiento" activo={filtro.situacion === 'enlazado'} onClick={() => set({ situacion: filtro.situacion === 'enlazado' ? '' : 'enlazado' })} />
            <Ficha valor={r.soloHoja} rotulo="Sólo en la hoja" nota="sin enlazar con Desk 2.0" activo={filtro.situacion === 'hoja'} onClick={() => set({ situacion: filtro.situacion === 'hoja' ? '' : 'hoja' })} />
            <Ficha valor={r.conAvisos} rotulo="Con avisos" nota="conviene mirarlas" activo={filtro.soloAvisos} onClick={() => set({ soloAvisos: !filtro.soloAvisos })} />
            <Ficha valor={r.retirados} rotulo="Retirados" nota="a mano · no cuentan" activo={filtro.retirados} onClick={() => set({ retirados: !filtro.retirados })} />
          </div>
        )}
        <ExportarHoja hoy={datos.hoy} recarga={recarga} />
        <div className="mt-3">
          <Alert tone="blue" title="Qué se corrige aquí y qué se sigue corrigiendo en Desk 2.0">
            La fecha de calibración ya se puede corregir aquí (Técnico y Director Técnico): abre la fila y usa «Corregir fecha» —registra una calibración manual, que puede corregir la de un ticket— o «Anular», siempre con su
            motivo; nada se borra. Un equipo que ya no existe, o una fila de la hoja que sobra, se puede retirar (Director Técnico): se sigue viendo, atenuado, sale de Resumen y Avisos, y se puede deshacer. Lo normal sigue siendo que la fecha llegue del ticket de Zoho, campo «Fecha de Calibración» (y se traen en «Configuración»). El cliente, la marca, el modelo y el serial NO se cambian en el portal: se
            corrigen en Desk 2.0 (y después se sincroniza el maestro en «Configuración»). Sólo lo que está «en el inventario» (los GRIMM EDM 180 y las marcas encendidas en «Configuración» → «Marcas en seguimiento») entra en Resumen,
            Equipos, Calendario y Avisos: lo enlazado fuera de seguimiento no genera avisos, tenga la fecha que tenga.
            {r.calibracionesSueltas > 0 && ` Hay ${r.calibracionesSueltas} calibraci${r.calibracionesSueltas === 1 ? 'ón' : 'ones'} de tickets cuyo serial no es de ninguna fila de la hoja.`}
          </Alert>
        </div>
      </Card>

      {c && (
        <>
          <label className="relative block">
            <span className="sr-only">Buscar por cliente, serial o modelo</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
            <input
              type="search"
              value={filtro.texto}
              onChange={(e) => set({ texto: e.target.value })}
              placeholder="Buscar por cliente, serial o modelo"
              className="block min-h-[44px] w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Marca">
            {r.porMarca.map((m) => (
              <Chip key={m.clave} activo={filtro.marcas.includes(m.clave)} onClick={() => set({ marcas: alternar(filtro.marcas, m.clave) })}>
                {etiquetaMarca(m.marca)}
                <span className="tabular-nums opacity-60">{m.total}</span>
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Estado">
            {ESTADOS.map((s) => (
              <Chip key={s} activo={filtro.estados.includes(s)} onClick={() => set({ estados: alternar(filtro.estados, s) })}>
                <span className={`h-2 w-2 rounded-full ${TONO[s].dot}`} aria-hidden />
                {ETIQUETA_ESTADO[s]}
                <span className="tabular-nums opacity-60">{r.porEstado[s]}</span>
              </Chip>
            ))}
            {(hayFiltroHoja(filtro) || orden.k !== 'fila') && (
              <button type="button" onClick={() => (setFiltro(FILTRO_HOJA_VACIO), setOrden(ORDEN_HOJA))} className="px-2 text-sm font-medium text-blue-600 hover:underline">
                Quitar filtros y volver al orden de la hoja
              </button>
            )}
          </div>
          <p className="text-sm text-gray-500" aria-live="polite">
            <span className="font-semibold text-gray-800">{textoContador(lista.length, r.total)}</span> · pulsa una fila para ver su detalle
          </p>
          <Tabla filas={lista} onAbrir={abrir} orden={orden} onOrden={ordenar} vacio="Ninguna fila cumple los filtros." />
        </>
      )}

      <details open={datos.fueraDeHoja.length > 0} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold text-gray-900">En el inventario o en Desk 2.0, y no en la hoja ({datos.fueraDeHoja.length})</summary>
        <p className="mb-3 text-xs text-gray-500">Equipos que no casan con ninguna fila de la hoja congelada: altas del maestro posteriores a la hoja, equipos de otras marcas que la hoja no tenía, o un serial que no se pudo emparejar.</p>
        {datos.fueraDeHoja.length === 0 && <Tabla filas={[]} onAbrir={abrir} vacio="Ninguno: todo lo enlazado está en la hoja." />}
        {fuera.map(([titulo, filas]) => filas.length > 0 && (
          <div key={titulo} className="mb-3 flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-800">{titulo} ({filas.length})</h3>
            <Tabla filas={filas} onAbrir={abrir} vacio="" />
          </div>
        ))}
      </details>

      {enPanel && <PanelFila f={enPanel} onClose={() => setPanel(null)} onCambio={async () => (setCambios((n) => n + 1), onCambio())} />}
    </div>
  );
}
