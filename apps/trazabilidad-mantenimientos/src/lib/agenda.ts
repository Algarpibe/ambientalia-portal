/**
 * Lo que la configuración de la agenda del taller calcula antes de pintar:
 * los tickets de cada etapa, las columnas y las casillas de la tabla de
 * duraciones, el orden y el filtro de los estados y los textos. Puro: sin
 * React ni red. Las reglas (categorías, etapas, topes) son las de dominio.ts,
 * las mismas que valida el servidor.
 */
import {
  CATEGORIAS_AGENDA,
  ETAPAS_AGENDA,
  ETIQUETA_CATEGORIA,
  ETIQUETA_ETAPA,
  TIPO_POR_DEFECTO,
  type CategoriaAgenda,
  type DuracionAgendaConfig,
  type EstadoDesk,
  type EtapaAgenda,
  type PlazoServicio,
  type TipoAbierto,
} from '../dominio';
import { fmtFechaHora } from './vistas';

/** Qué hace cada categoría con el ticket en la agenda, en una frase. */
const AYUDA_CATEGORIA: Record<CategoriaAgenda, string> = {
  por_llegar: 'El equipo aún no ha llegado: lista aparte, sin fechas.',
  entrada: 'Llegó y espera su primera etapa.',
  activa: 'Ocupa un puesto de la etapa que elijas.',
  standby: 'No ocupa puesto: depende del cliente, de Comercial, de Compras o de terceros.',
  fin: 'Trabajo hecho: libera el puesto.',
  fuera: 'No sale en la agenda (soporte remoto).',
};

/** Las opciones del desplegable de categoría de un estado, en su orden. */
export const OPCIONES_CATEGORIA: readonly { valor: CategoriaAgenda; texto: string; ayuda: string }[] = CATEGORIAS_AGENDA.map((valor) => ({
  valor,
  texto: ETIQUETA_CATEGORIA[valor],
  ayuda: AYUDA_CATEGORIA[valor],
}));

/** Cuántos tickets abiertos están hoy en un estado de cada etapa (tengan puesto o no). */
export function ticketsPorEtapa(estados: readonly EstadoDesk[]): Record<EtapaAgenda, number> {
  const n = Object.fromEntries(ETAPAS_AGENDA.map((e) => [e, 0])) as Record<EtapaAgenda, number>;
  for (const e of estados) if (e.categoria === 'activa' && e.etapa) n[e.etapa] += e.ticketsAbiertos;
  return n;
}

export function sinCategoria(estados: readonly EstadoDesk[]): EstadoDesk[] {
  return estados.filter((e) => e.categoria === null);
}

/**
 * Los estados de la tabla de categorías: los que no tienen categoría, arriba
 * (son los que piden una decisión) y el resto en el orden del servidor. Con
 * `soloConTickets` se quitan los que hoy no tiene ningún ticket, salvo los sin
 * categoría, que salen siempre.
 */
export function estadosAgenda(estados: readonly EstadoDesk[], soloConTickets: boolean): EstadoDesk[] {
  const resto = estados.filter((e) => e.categoria !== null && (!soloConTickets || e.ticketsAbiertos > 0));
  return [...sinCategoria(estados), ...resto];
}

/** El aviso que sale al guardar la categoría de un estado: «Notificado: etapa activa · Diagnóstico». */
export function avisoCategoria(etiqueta: string, categoria: CategoriaAgenda, etapa: EtapaAgenda | null): string {
  return `${etiqueta}: ${ETIQUETA_CATEGORIA[categoria].toLowerCase()}${etapa ? ` · ${ETIQUETA_ETAPA[etapa]}` : ''}`;
}

export interface ColumnaDuracion {
  /** La clave del tipo de servicio, o «*». */
  tipo: string;
  etiqueta: string;
  /** Por qué está la columna, cuando no es un tipo de los de siempre: el `title` de su cabecera. */
  nota: string;
}

/**
 * Las columnas de la tabla de duraciones: la «*» (por defecto), los tipos de
 * `tmc_plazos` en su orden, los que traen los tickets abiertos de la fuente de
 * la agenda y, para poder quitarlas, los de las duraciones ya guardadas que no
 * estén en ninguno de los dos sitios. Sin repetir.
 */
export function columnasDuraciones(plazos: readonly PlazoServicio[], tiposAbiertos: readonly TipoAbierto[], duraciones: readonly DuracionAgendaConfig[]): ColumnaDuracion[] {
  const cols = new Map<string, ColumnaDuracion>([
    [TIPO_POR_DEFECTO, { tipo: TIPO_POR_DEFECTO, etiqueta: TIPO_POR_DEFECTO, nota: 'Por defecto: vale para todo tipo sin duración propia, y para los tickets sin tipo.' }],
  ]);
  const poner = (tipo: string, etiqueta: string, nota: string) => {
    if (!cols.has(tipo)) cols.set(tipo, { tipo, etiqueta, nota });
  };
  for (const p of plazos) poner(p.clave, p.etiqueta, '');
  for (const t of tiposAbiertos) poner(t.clave, t.etiqueta, 'Lo traen los tickets abiertos; no tiene plazo configurado.');
  for (const d of duraciones) poner(d.tipo, d.tipo, 'Ya no está entre los tipos de servicio: vacía la casilla para quitarlo.');
  return [...cols.values()];
}

/** Una casilla de la tabla: su fila guardada, si la tiene, y lo que vale vacía (la «*» de su etapa). */
export function celdaDuracion(duraciones: readonly DuracionAgendaConfig[], etapa: EtapaAgenda, tipo: string): { propia: DuracionAgendaConfig | null; heredada: number | null } {
  const de = (t: string) => duraciones.find((d) => d.etapa === etapa && d.tipo === t) ?? null;
  return { propia: de(tipo), heredada: tipo === TIPO_POR_DEFECTO ? null : (de(TIPO_POR_DEFECTO)?.dias ?? null) };
}

/**
 * Lo escrito en una casilla numérica: el entero a guardar (null = vacía, sólo
 * donde `vacio` lo admite) o el mensaje si no vale. La misma regla que el servidor.
 */
export function leerEntero(txt: string, r: { min: number; max: number; vacio: boolean }): { valor: number | null } | { error: string } {
  const t = txt.trim();
  if (t === '' && r.vacio) return { valor: null };
  const n = Number(t);
  if (!/^\d+$/.test(t) || n < r.min || n > r.max) return { error: `Un número entero entre ${r.min} y ${r.max}${r.vacio ? ', o vacío' : ''}.` };
  return { valor: n };
}

/** Quién cambió algo y cuándo (hora de Colombia). Lo que puso una migración es «semilla»; sin firma, `inicial`. */
export function firma(por: string | null, en: string | null, inicial = 'valor inicial'): string {
  if (!por) return inicial;
  return por.startsWith('semilla') ? 'semilla' : `${por} · ${fmtFechaHora(en)}`;
}
