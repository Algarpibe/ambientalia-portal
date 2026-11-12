// Tablero kanban del taller (solo lectura): KPIs, 6 columnas, tarjetas y leyenda. `TableroVista` es
// puro (recibe el modelo ya construido); `Tablero` lo alimenta con el sondeo de GET /api/equipos-taller.
// Los colores salen SOLO de los tokens --tt-* (temas.ts); los textos de la pantalla, en español.
import { useCallback, useMemo, type ReactNode } from 'react';
import {
  AJUSTES_TABLERO_POR_DEFECTO, aplicarAjustes, construirTablero, horaBogota,
  type AjustesTablero, type ColumnaTablero, type RespuestaEquipos, type Tablero as TableroModelo, type Tarjeta as TarjetaModelo,
} from '../nucleo';
import { apiEquipos, type ApiEquipos } from '../api';
import './fuentes';
import './tablero.css';
import { MEDIDAS, alturaTarjeta, planColumna } from './medidas';
import { resolverTema } from './pantalla';
import { cssTemas } from './temas';
import { useSondeo } from './useSondeo';

export type TemaPantalla = 'dia' | 'noche' | 'sistema';

const dos = (n: number) => String(n).padStart(2, '0');
/** HH:MM en Bogotá de un instante en milisegundos. */
export const hhmm = (ms: number): string => `${dos(horaBogota(ms))}:${dos(new Date(ms - 5 * 3600e3).getUTCMinutes())}`;

export function Raiz({ tema, children, clase = '' }: { tema: TemaPantalla; children: ReactNode; clase?: string }) {
  return (
    <div className={`tt-tablero ${clase}`.trim()} data-tema={tema}>
      <style href="tt-temas" precedence="tt">{cssTemas()}</style>
      {children}
    </div>
  );
}

function Pie({ t }: { t: TarjetaModelo }) {
  return (
    <div className="tt-pie">
      {t.pie === 'tecnico' && t.tecnico ? (
        <>
          <span className={`tt-av tt-av-${t.tecnico.avatar}`}>{t.tecnico.iniciales}</span>
          <span className="tt-tecnico">{t.tecnico.nombre}</span>
        </>
      ) : t.pie === 'sin_asignar' ? (
        <>
          <span className="tt-av tt-av-sin">?</span>
          <span className="tt-tecnico tt-tecnico-sin">Sin asignar</span>
        </>
      ) : (
        <>
          <span className="tt-av tt-av-neutro">–</span>
          <span className="tt-tecnico tt-tecnico-neutro">Sin técnico</span>
        </>
      )}
      {t.ticket ? <span className="tt-ticket tt-mono">{`#${t.ticket}`}</span> : null}
    </div>
  );
}

function Tarjeta({ t, compacta, presupuesto }: { t: TarjetaModelo; compacta: boolean; presupuesto: boolean }) {
  const alto = presupuesto ? { height: compacta ? MEDIDAS.compacta : alturaTarjeta(t.etiquetas.length) } : undefined;
  const dias = <span className={`tt-dias tt-dias-${t.tono}`}>{`${t.dias} d`}</span>;
  if (compacta) {
    return (
      <article className="tt-tarjeta tt-tarjeta-compacta" aria-label={`Equipo ${t.sn}`} title={t.equipo} style={alto}>
        <div className="tt-tarjeta-cab">
          <span className="tt-sn tt-mono">{t.sn}</span>
          {t.etiquetas.length ? <span className="tt-marca" title={t.etiquetas.map((e) => e.texto).join(' · ')} /> : null}
          {dias}
        </div>
        <div className="tt-cliente">{t.cliente}</div>
        <Pie t={t} />
      </article>
    );
  }
  return (
    <article className="tt-tarjeta" aria-label={`Equipo ${t.sn}`} style={alto}>
      <div className="tt-tarjeta-cab">
        <span className="tt-sn tt-mono">{t.sn}</span>
        {dias}
      </div>
      <div className="tt-equipo">{t.equipo}</div>
      <div className="tt-cliente">{t.cliente}</div>
      {t.etiquetas.length ? (
        <div className="tt-etiquetas">{t.etiquetas.map((e) => <span key={e.tipo + e.texto} className="tt-etiqueta">{e.texto}</span>)}</div>
      ) : null}
      <Pie t={t} />
    </article>
  );
}

function Columna({ col, presupuesto }: { col: ColumnaTablero; presupuesto: boolean }) {
  const plan = presupuesto
    ? planColumna(col.tarjetas.map((t) => ({ etiquetas: t.etiquetas.length })))
    : { densidad: 'completa' as const, visibles: col.tarjetas.length, ocultas: 0 };
  return (
    <section className={`tt-col tt-col-${col.id}`} aria-label={col.nombre} data-densidad={plan.densidad}>
      <div className="tt-col-cab">
        <span className="tt-punto" aria-hidden />
        <h3 className="tt-col-nombre">{col.nombre}</h3>
        <span className="tt-cuenta" aria-label={`Total ${col.tarjetas.length}`}>{col.tarjetas.length}</span>
      </div>
      <p className="tt-col-desc">{col.descripcion}</p>
      {col.tarjetas.length === 0 ? <div className="tt-vacio">Sin equipos</div> : null}
      {col.tarjetas.slice(0, plan.visibles).map((t) => (
        <Tarjeta key={t.clave} t={t} compacta={plan.densidad === 'compacta'} presupuesto={presupuesto} />
      ))}
      {plan.ocultas > 0 ? <div className="tt-mas" style={{ height: MEDIDAS.mas }}>{`+${plan.ocultas} más`}</div> : null}
    </section>
  );
}

function Leyenda({ ajustes }: { ajustes: AjustesTablero }) {
  return (
    <footer className="tt-leyenda">
      <div className="tt-leyenda-izq">
        <b>Días en taller:</b>
        <span><i className="tt-cuadro tt-cuadro-verde" />{`menos de ${ajustes.umbralAmbar} d`}</span>
        <span><i className="tt-cuadro tt-cuadro-ambar" />{`${ajustes.umbralAmbar} – ${ajustes.umbralRojo} d`}</span>
        <span><i className="tt-cuadro tt-cuadro-rojo" />{`más de ${ajustes.umbralRojo} d`}</span>
        <span><i className="tt-circulo-sin" />sin técnico asignado</span>
      </div>
      <span>Ordenado por antigüedad · fuente: Zoho Desk + remisiones</span>
    </footer>
  );
}

/** «Actualizado HH:MM · datos de las HH:MM · se refresca cada 60 s». */
export function lineaEstado(okEn: number, datosEn: string | null): string {
  const datos = datosEn ? Date.parse(datosEn) : NaN;
  return `Actualizado ${hhmm(okEn)}${Number.isFinite(datos) ? ` · datos de las ${hhmm(datos)}` : ''} · se refresca cada 60 s`;
}

export interface PropsTableroVista {
  tablero: TableroModelo;
  ajustes: AjustesTablero;
  tema?: TemaPantalla;
  /** Aplica el presupuesto de alto de la TV: densidad compacta y «+N más». La pestaña de la app no lo usa. */
  presupuesto?: boolean;
  /** Instante (ms) del último acierto del sondeo. */
  okEn?: number | null;
  /** Hora de la foto de datos (ISO). */
  datosEn?: string | null;
  obsoleto?: boolean;
  /** Cabecera propia (la TV): sustituye a la línea de estado de la pestaña. */
  cabecera?: ReactNode;
}

export function TableroVista({ tablero, ajustes, tema = 'dia', presupuesto = false, okEn = null, datosEn = null, obsoleto = false, cabecera }: PropsTableroVista) {
  return (
    <Raiz tema={tema}>
      {obsoleto && okEn !== null ? <p role="alert" className="tt-aviso">{`Datos desactualizados desde ${hhmm(okEn)}`}</p> : null}
      {cabecera ?? (okEn !== null ? <p className="tt-estado"><span>{lineaEstado(okEn, datosEn)}</span></p> : null)}
      <ul className="tt-kpis" aria-label="Indicadores">
        {tablero.kpis.map((k) => (
          <li key={k.id} className="tt-kpi">
            <span className={`tt-kpi-n tt-tono-${k.tono}`}>{k.valor}</span>
            <span className="tt-kpi-e">{k.etiqueta}</span>
          </li>
        ))}
      </ul>
      <div className="tt-columnas">
        {tablero.columnas.map((c) => <Columna key={c.id} col={c} presupuesto={presupuesto} />)}
      </div>
      <Leyenda ajustes={ajustes} />
    </Raiz>
  );
}

/** Sondea una fuente cada 60 s y arma el modelo en el navegador con el núcleo compartido. */
export function useTableroDatos(pedir: (senal: AbortSignal) => Promise<RespuestaEquipos>) {
  const { datos, okEn, fallo, obsoleto, ahora } = useSondeo(pedir);
  const ajustes = datos?.tablero ?? AJUSTES_TABLERO_POR_DEFECTO;
  const snap = datos?.snap ?? null;
  const modelo = useMemo(
    () => (datos && snap ? construirTablero(aplicarAjustes(snap.rows, datos.ajustes), ajustes, ahora) : null),
    [datos, snap, ajustes, ahora],
  );
  return { datos, modelo, ajustes, datosEn: snap?.at ?? null, okEn, fallo, obsoleto, ahora };
}

/** Mensaje mientras no hay tablero que dibujar: carga, sin acceso, red caída o sin datos. */
export function SinTablero({ tema, hayDatos, fallo, kiosco = false }: { tema: TemaPantalla; hayDatos: boolean; fallo: 'red' | 'acceso' | null; kiosco?: boolean }) {
  return (
    <Raiz tema={tema}>
      {hayDatos ? <p className="tt-mensaje">Aún no hay datos. Se actualizan solos cuando termina la sincronización con n8n.</p>
        : fallo === 'acceso' && kiosco ? <p role="alert" className="tt-mensaje">La llave de esta pantalla no es válida o fue revocada. Pide una nueva en Ajustes.</p>
        : fallo === 'acceso' ? <p role="alert" className="tt-mensaje">No tienes acceso al tablero. Vuelve a iniciar sesión o pide la app «Equipos en taller».</p>
        : fallo ? <p role="alert" className="tt-mensaje">No se pudo cargar el tablero. Se reintenta cada 60 s.</p>
        : <p className="tt-mensaje">Cargando tablero…</p>}
    </Raiz>
  );
}

/**
 * La pestaña «Tablero» de la app, con los datos de GET /api/equipos-taller. Sin `tema`, sigue el «Tema del
 * tablero» de Ajustes (el mismo que la TV): Día, Noche o Automático por horario, recalculado en cada ciclo
 * del sondeo de 60 s. Sin ajustes del servidor, Día.
 */
export default function Tablero({ api: apiProp, tema: temaFijo }: { api?: ApiEquipos; tema?: TemaPantalla }) {
  const api = useMemo(() => apiProp || apiEquipos(), [apiProp]);
  const pedir = useCallback((senal: AbortSignal) => api.estado(senal), [api]);
  const { datos, modelo, ajustes, datosEn, okEn, fallo, obsoleto, ahora } = useTableroDatos(pedir);
  const tema: TemaPantalla = temaFijo ?? resolverTema(null, ahora, ajustes);
  if (!modelo) return <SinTablero tema={tema} hayDatos={!!datos} fallo={fallo} />;
  return <TableroVista tablero={modelo} ajustes={ajustes} tema={tema} okEn={okEn} datosEn={datosEn} obsoleto={obsoleto} />;
}
