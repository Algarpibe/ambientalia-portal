/**
 * Lo que la pantalla «Agenda del taller» (lote 7) calcula antes de pintar: el
 * eje y sus días no hábiles, la geometría de las barras de cada puesto, el
 * resumen de cada etapa, la lista por días del teléfono y los textos. Puro:
 * sin React ni red, y con «hoy» y el eje como argumentos (no mira el reloj).
 *
 * Aquí no se decide nada de la agenda: puestos, filas y fechas previstas
 * llegan ya calculados de GET /trazabilidad/agenda. Sólo se colocan.
 */
import { diasEntre, type DetalleTicket, type FlujoAgenda, type EtapaAgenda, type EtapaProyectada, type NombreFuente, type PuestoAgenda, type RespuestaAgenda, type TicketEnFila } from '../dominio';
import { columna, diasDelEje, type Eje } from './servicios';
import { fmtFecha, fmtFechaHora } from './vistas';

/** Cada cuánto se vuelve a pedir la agenda sola. hub-api limita a 60 peticiones por minuto a toda la oficina: nada más frecuente. */
export const REFRESCO_MS = 120_000;

/** ¿Toca pedir la agenda otra vez? Sólo con la pestaña a la vista y pasados `REFRESCO_MS` desde la última petición. */
export const tocaRefrescar = (ahora: number, ultima: number, visible: boolean): boolean => visible && ahora - ultima >= REFRESCO_MS;

// ── Eje ─────────────────────────────────────────────────────────────────────

/** El eje de columnas (una por día) del tramo que manda el servidor. */
export function ejeDeAgenda(e: RespuestaAgenda['eje']): Eje {
  return { inicio: e.desde, fin: e.hasta, dias: columna({ inicio: e.desde, fin: e.hasta, dias: 0 }, e.hasta) + 1 };
}

const LETRAS = ['do', 'lu', 'ma', 'mi', 'ju', 'vi', 'sá'];
const diaSemana = (fecha: string): number => new Date(`${fecha}T00:00:00Z`).getUTCDay();
/** El día de la semana de una fecha, en dos letras. */
export const letraDia = (fecha: string): string => LETRAS[diaSemana(fecha)];

export interface DiaAgenda {
  fecha: string;
  dia: number;
  /** Día de la semana, en dos letras. */
  letra: string;
  habil: boolean;
  /** Por qué no es hábil (para el `title`); `null` si lo es. */
  motivo: 'Fin de semana' | 'Festivo' | 'Cierre de empresa' | null;
}

/** Las columnas del eje, cada una con su porqué si no es hábil. */
export function diasAgenda(e: RespuestaAgenda['eje']): DiaAgenda[] {
  const festivos = new Set(e.festivos);
  return diasDelEje(ejeDeAgenda(e), [...e.festivos, ...e.cierres]).map((d) => {
    const dow = diaSemana(d.fecha);
    const motivo = dow === 0 || dow === 6 ? 'Fin de semana' : festivos.has(d.fecha) ? 'Festivo' : d.habil ? null : 'Cierre de empresa';
    return { ...d, letra: LETRAS[dow], motivo };
  });
}

// ── Barras ──────────────────────────────────────────────────────────────────

/** Un trozo de barra, en columnas con decimales (0 = borde izquierdo del eje), ya recortado al eje. */
export interface Franja {
  desde: number;
  hasta: number;
}

/**
 * De la MITAD de la columna de `desde` a la mitad de la de `hasta`: el día de
 * inicio no cuenta en la duración y el día en que sale uno entra el siguiente,
 * así que dos barras seguidas se tocan sin pisarse. Null si queda fuera.
 */
function franja(eje: Eje, desde: string, hasta: string): Franja | null {
  const f = { desde: Math.max(columna(eje, desde) + 0.5, 0), hasta: Math.min(columna(eje, hasta) + 0.5, eje.dias) };
  return f.desde < f.hasta ? f : null;
}

export interface BarraOcupante {
  /** Lo ya transcurrido (sólido): del inicio a hoy o, pasado de fecha, al día en que debía acabar. */
  hecho: Franja | null;
  /** Lo que falta (tono claro): de hoy al fin estimado. */
  resto: Franja | null;
  /** El retraso (rayado en rojo): del día en que debía acabar a hoy. */
  retraso: Franja | null;
  cortadaIzq: boolean;
  cortadaDer: boolean;
}

/** La barra de quien ocupa un puesto; null si está libre. Sin duración sólo hay lo transcurrido. */
export function barraOcupante(p: PuestoAgenda, eje: Eje, hoy: string): BarraOcupante | null {
  if (!p.ocupante || !p.inicio) return null;
  const tope = p.pasadoDeFecha && p.finPlanificado ? p.finPlanificado : p.finEstimado !== null && p.finEstimado < hoy ? p.finEstimado : hoy;
  return {
    hecho: p.inicio < tope ? franja(eje, p.inicio, tope) : null,
    resto: p.finEstimado !== null && p.finEstimado > hoy ? franja(eje, p.inicio > hoy ? p.inicio : hoy, p.finEstimado) : null,
    retraso: p.pasadoDeFecha && p.finPlanificado ? franja(eje, p.finPlanificado, hoy) : null,
    cortadaIzq: p.inicio < eje.inicio,
    cortadaDer: p.finEstimado !== null && p.finEstimado > eje.fin,
  };
}

/** La barra de un previsto (contorno discontinuo): de su entrada a su fin previstos. Null si no tiene fechas. */
export function barraPrevista(t: { entradaPrevista: string | null; finPrevisto: string | null }, eje: Eje): { franja: Franja | null; cortadaDer: boolean } | null {
  if (!t.entradaPrevista || !t.finPrevisto) return null;
  return { franja: franja(eje, t.entradaPrevista, t.finPrevisto), cortadaDer: t.finPrevisto > eje.fin };
}

export interface Previsto {
  numero: number;
  entradaPrevista: string;
  finPrevisto: string;
  /** Equipo nuevo que llegará de la etapa anterior: aún no está en esta. */
  encadenado: boolean;
}

/** Quién se prevé que pase por un puesto, por orden de entrada: los de su fila y los equipos nuevos encadenados. */
export function previstosDePuesto(e: EtapaProyectada, puesto: number): Previsto[] {
  const de = (lista: readonly { numero: number; puestoPrevisto: number | null; entradaPrevista: string | null; finPrevisto: string | null }[], encadenado: boolean) =>
    lista.flatMap((t) => (t.puestoPrevisto === puesto && t.entradaPrevista && t.finPrevisto ? [{ numero: t.numero, entradaPrevista: t.entradaPrevista, finPrevisto: t.finPrevisto, encadenado }] : []));
  return [...de(e.fila, false), ...de(e.encadenados, true)].sort((a, b) => (a.entradaPrevista < b.entradaPrevista ? -1 : a.entradaPrevista > b.entradaPrevista ? 1 : a.numero - b.numero));
}

// ── Resumen y textos ────────────────────────────────────────────────────────

export type TonoSaturacion = 'verde' | 'ambar' | 'rojo' | 'gris';

export interface ResumenEtapa {
  ocupados: number;
  puestos: number;
  tono: TonoSaturacion;
  /** El tono, dicho con palabras: el color no va solo. */
  saturacion: string;
  enFila: number;
  primerHueco: string | null;
}

/** Puestos ocupados / total con su saturación, tickets en la fila y primer hueco de una etapa. */
export function resumenEtapa(e: EtapaProyectada): ResumenEtapa {
  const { ocupados, puestos } = e.saturacion;
  const [tono, saturacion]: [TonoSaturacion, string] =
    puestos === 0 && ocupados === 0
      ? ['gris', 'Sin puestos']
      : ocupados > puestos
        ? ['rojo', 'Por encima de sus puestos']
        : ocupados === puestos
          ? ['rojo', 'Llena']
          : ocupados / puestos >= 2 / 3
            ? ['ambar', 'Casi llena']
            : ['verde', 'Con sitio'];
  return { ocupados, puestos, tono, saturacion, enFila: e.fila.length, primerHueco: e.primerHueco };
}

/** El rótulo fijo de la fuente; en respaldo dice además lo que la réplica no puede dar. */
export const rotuloFuente = (fuente: NombreFuente): string =>
  fuente === 'principal' ? 'Desk 2.0 (principal)' : 'Réplica de Zoho (respaldo) · sin prioridad · sin cierres de empresa · flujo deducido';

export interface Marca {
  texto: string;
  ayuda: string;
  tono: 'gray' | 'blue' | 'amber';
}

/** Las marcas de un ticket de la fila, con su texto y su explicación. */
export function marcasDeFila(t: TicketEnFila): Marca[] {
  const m: Marca[] = [];
  if (t.marcas.prioridad) m.push({ texto: 'prioridad', ayuda: 'Tiene prioridad fijada en Desk 2.0: va por delante de toda la fila.', tono: 'blue' });
  if (t.marcas.faltaRemision) m.push({ texto: 'falta fecha de remisión', ayuda: 'No tiene fecha de remisión de entrada: va al final de la fila hasta que se escriba en Zoho Desk.', tono: 'amber' });
  if (t.marcas.sinTipo) m.push({ texto: 'sin tipo', ayuda: 'Sin tipo de servicio: usa la duración por defecto de la etapa.', tono: 'gray' });
  if (t.marcas.ordenAproximado) m.push({ texto: 'orden aproximado', ayuda: 'No consta cuándo llegó exactamente, o empata con otro: su sitio lo decide el número de ticket.', tono: 'gray' });
  if (t.marcas.sinDuracion) m.push({ texto: 'sin duración', ayuda: 'Ni su tipo ni la etapa tienen duración configurada: no se le pueden dar fechas.', tono: 'amber' });
  if (t.situacion === 'entrada') m.push({ texto: 'en fila de entrada', ayuda: 'Todavía no está en un estado de esta etapa: no se le puede asignar puesto.', tono: 'gray' });
  return m;
}

/** La ficha de un ticket, por número; null si la fuente no lo trae. */
export const detalleDe = (a: Pick<RespuestaAgenda, 'tickets'>, numero: number): DetalleTicket | null => a.tickets.find((t) => t.numero === numero) ?? null;

export const ETIQUETA_FLUJO: Record<FlujoAgenda, string> = { servicio: 'Servicio', equipo_nuevo: 'Equipo nuevo' };
const ORIGEN_FLUJO: Record<DetalleTicket['flujoOrigen'], string> = {
  clasificacion: 'según la clasificación del ticket',
  manual: 'marcado a mano',
  deducido: 'deducido del asunto y del código (respaldo)',
  defecto: 'por defecto: el ticket no trae clasificación',
};
/** El flujo de un ticket (servicio o equipo nuevo) y de dónde sale. */
export const textoFlujo = (d: Pick<DetalleTicket, 'flujo' | 'flujoOrigen'>): string => `${ETIQUETA_FLUJO[d.flujo]} · ${ORIGEN_FLUJO[d.flujoOrigen]}`;

/** Desde cuándo está el ticket en su estado, y cómo se sabe. */
export function textoTransicion(d: DetalleTicket): string {
  const u = d.ultimaTransicion;
  if (!u) return `No consta cuándo entró en «${d.estado}».`;
  if (u.origen === 'primera_observacion') return `En «${d.estado}» al menos desde el ${fmtFechaHora(u.en)}, cuando el portal lo vio por primera vez: no consta cuándo entró.`;
  return `Entró en «${d.estado}» el ${fmtFechaHora(u.en)} (${u.origen === 'fuente' ? 'transición registrada en Desk 2.0' : 'cambio visto por el portal'}).`;
}

/** Todo el detalle de la barra de un puesto ocupado, para su `title`. */
export function tituloOcupante(p: PuestoAgenda, etapa: string, d: DetalleTicket | null): string {
  const o = p.ocupante!;
  const fin =
    p.finEstimado === null
      ? 'sin duración configurada'
      : p.pasadoDeFecha
        ? `debía acabar el ${fmtFecha(p.finPlanificado)}: pasado de fecha, se supone que sale el ${fmtFecha(p.finEstimado)}`
        : `fin estimado ${fmtFecha(p.finEstimado)}`;
  return [`Ticket ${o.numero}`, d?.asunto, o.estado ?? 'sin datos de la fuente', `${etapa}, puesto ${p.puesto}`, `desde ${fmtFecha(p.inicio)}`, fin].filter(Boolean).join(' · ');
}

export type Situacion =
  | { donde: 'puesto'; etapa: EtapaAgenda; etiqueta: string; puesto: PuestoAgenda }
  | { donde: 'fila'; etapa: EtapaAgenda; etiqueta: string; fila: TicketEnFila }
  | { donde: 'standby' | 'por_llegar' | 'sin_categoria' | 'otro' };

/** Dónde está hoy un ticket en la agenda; `otro` = fin de taller, fuera de la agenda o no viene. */
export function situacionDe(a: RespuestaAgenda, numero: number): Situacion {
  for (const e of a.etapas) {
    const puesto = e.puestos.find((p) => p.ocupante?.numero === numero);
    if (puesto) return { donde: 'puesto', etapa: e.etapa, etiqueta: e.etiqueta, puesto };
    const fila = e.fila.find((t) => t.numero === numero);
    if (fila) return { donde: 'fila', etapa: e.etapa, etiqueta: e.etiqueta, fila };
  }
  if (a.standby.some((t) => t.numero === numero)) return { donde: 'standby' };
  if (a.porLlegar.some((t) => t.numero === numero)) return { donde: 'por_llegar' };
  return { donde: a.sinCategoria.some((g) => g.tickets.includes(numero)) ? 'sin_categoria' : 'otro' };
}

/** La previsión de un equipo nuevo en la etapa a la que llegará encadenado, si la tiene. */
export function encadenadoDe(a: RespuestaAgenda, numero: number) {
  for (const e of a.etapas) {
    const t = e.encadenados.find((x) => x.numero === numero);
    if (t) return { ...t, etiqueta: e.etiqueta };
  }
  return null;
}

/** Cuántos días de calendario (de Colombia) lleva un ticket en su estado, según su última transición conocida. */
export function diasEnEstado(d: DetalleTicket | null, hoy: string): string {
  const u = d?.ultimaTransicion;
  if (!u) return 'no consta desde cuándo';
  // Colombia va cinco horas por detrás de UTC todo el año: aritmética sobre UTC, sin depender de la zona de la máquina.
  const dia = new Date(Date.parse(u.en) - 5 * 3_600_000).toISOString().slice(0, 10);
  const n = Math.max(0, diasEntre(dia, hoy));
  return `${u.origen === 'primera_observacion' ? 'al menos ' : ''}${n} día${n === 1 ? '' : 's'}`;
}

// ── Lista por días (teléfono) ───────────────────────────────────────────────

export interface LineaDia {
  numero: number;
  puesto: number;
  /** `ocupa`: está hoy en el puesto; `entra` / `termina`: lo que pasa ese día. */
  que: 'ocupa' | 'termina' | 'entra';
  /** Es una previsión de la fila, no alguien con puesto. */
  previsto: boolean;
  retraso: boolean;
}

export interface DiaLista {
  fecha: string;
  etapas: { etapa: EtapaAgenda; etiqueta: string; lineas: LineaDia[] }[];
}

const ORDEN_QUE = { ocupa: 0, termina: 1, entra: 2 } as const;

/**
 * La agenda como lista, para el teléfono: hoy, quién ocupa cada puesto; y cada
 * día (hoy incluido) quién termina y quién se prevé que entre, por etapa. Sólo
 * los días en que pasa algo.
 */
export function listaPorDias(a: RespuestaAgenda): DiaLista[] {
  const dias = new Map<string, Map<EtapaAgenda, LineaDia[]>>();
  const poner = (fecha: string | null, etapa: EtapaAgenda, linea: LineaDia) => {
    if (!fecha) return;
    const dia = dias.get(fecha) ?? new Map<EtapaAgenda, LineaDia[]>();
    dia.set(etapa, [...(dia.get(etapa) ?? []), linea]);
    dias.set(fecha, dia);
  };
  for (const e of a.etapas) {
    for (const p of e.puestos) {
      if (!p.ocupante) continue;
      const base = { numero: p.ocupante.numero, puesto: p.puesto, previsto: false, retraso: p.pasadoDeFecha };
      poner(a.hoy, e.etapa, { ...base, que: 'ocupa' });
      poner(p.finEstimado, e.etapa, { ...base, que: 'termina' });
    }
    for (const t of [...e.fila, ...e.encadenados]) {
      if (t.puestoPrevisto === null) continue;
      const base = { numero: t.numero, puesto: t.puestoPrevisto, previsto: true, retraso: false };
      poner(t.entradaPrevista, e.etapa, { ...base, que: 'entra' });
      poner(t.finPrevisto, e.etapa, { ...base, que: 'termina' });
    }
  }
  return [...dias.keys()].sort().map((fecha) => ({
    fecha,
    etapas: a.etapas
      .filter((e) => dias.get(fecha)!.has(e.etapa))
      .map((e) => ({ etapa: e.etapa, etiqueta: e.etiqueta, lineas: [...dias.get(fecha)!.get(e.etapa)!].sort((x, y) => ORDEN_QUE[x.que] - ORDEN_QUE[y.que] || x.puesto - y.puesto || x.numero - y.numero) })),
  }));
}
