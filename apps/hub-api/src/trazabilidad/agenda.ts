/**
 * La PROYECCIÓN de la agenda del taller (lote 3; secciones B.5, F y H de
 * docs/trazabilidad-agenda-taller.md): con los tickets abiertos, la
 * configuración y las asignaciones vigentes, reparte cada ticket en su sitio
 * —puesto, fila de su etapa, standby, por llegar, fin de taller, fuera o «sin
 * categoría»— y simula cuándo entrará y saldrá cada uno de la fila.
 *
 * PURA: todo llega como argumento, «hoy» incluido. No mira el reloj ni
 * ninguna base, no escribe nada y no cambia lo que recibe; la misma entrada da
 * siempre la misma salida. Sólo de servidor, por el calendario.
 *
 * Las reglas no se repiten aquí: categoría, flujo, etapa inicial y duración
 * son las de dominio.ts (lote 2), y los días hábiles, los de
 * agenda-calendario.ts. Lo propio de este módulo es el ORDEN de cada fila y el
 * reparto FIFO.
 *
 * La salida es un objeto serializable, sin clientes, seriales ni correos:
 * sólo números de ticket, estados, fechas y marcas.
 */

import { hoyEnColombia } from '../ausencias/saldo.js';
import { primerDiaHabilAgenda, sumarDiasHabilesAgenda } from './agenda-calendario.js';
import {
  ETAPAS_AGENDA,
  ETIQUETA_ETAPA,
  categoriaDeEstado,
  claveEstadoDesk,
  claveTipoServicio,
  diasEntre,
  duracionDeEtapa,
  etapaInicial,
  etiquetaEstadoDesk,
  flujoDeTicket,
  type CategoriaEstado,
  type DuracionEtapa,
  type EtapaAgenda,
  type FlujoAgenda,
} from './dominio.js';
import type { EstadoFuente, MotivoRespaldo, NombreFuente, TicketTaller } from './fuente.js';

// ── Entrada ─────────────────────────────────────────────────────────────────

/**
 * Un puesto ocupado: la asignación vigente de un ticket (las crea y las cierra
 * el lote 4, tabla tmc_agenda_asignaciones; hasta entonces la lista llega
 * vacía). `desde` es el DÍA (AAAA-MM-DD) desde el que cuenta la duración.
 */
export interface AsignacionAgenda {
  /** Número del ticket. */
  numero: number;
  etapa: EtapaAgenda;
  /** Número del puesto dentro de la etapa, desde 1. */
  puesto: number;
  desde: string;
}

export interface EntradaAgenda {
  /** El día para el que se calcula (AAAA-MM-DD, en Colombia). */
  hoy: string;
  /** Los abiertos de la fuente (`FuenteAgenda.ticketsAbiertos`). */
  tickets: readonly TicketTaller[];
  /** Categoría guardada de cada estado, por clave (`leerCategoriasEstados`); lo que no esté ahí cae en el catálogo. */
  categorias: { get(clave: string): CategoriaEstado | null | undefined };
  /** Puestos por etapa y duraciones por etapa y tipo (`leerConfigAgenda` vale tal cual). */
  config: {
    etapas: readonly { etapa: EtapaAgenda; etiqueta: string; orden: number; puestos: number }[];
    duraciones: readonly DuracionEtapa[];
  };
  /** Tipo de servicio puesto a mano, por número de ticket (tmc_servicios_tipo): gana al de la fuente. */
  tiposManuales: { get(numero: number): string | null | undefined };
  /** Cierres de empresa (AAAA-MM-DD); vacío en respaldo (D3). */
  cierres: readonly string[];
  /** De aquí salen los avisos globales; la proyección no cambia con él. */
  estadoFuente: EstadoFuente;
  asignaciones: readonly AsignacionAgenda[];
  /**
   * Tickets que el historial del portal muestra VOLVIENDO de un standby a su
   * estado de ahora (los calculará el lote 4). Sin él nadie cuenta como vuelto.
   */
  vuelvenDeStandby?: readonly number[];
  /** Flujo marcado a mano por ticket (lote 4, tmc_agenda_flujo): gana a la fuente (D11). */
  flujosManuales?: { get(numero: number): FlujoAgenda | null | undefined };
}

// ── Salida ──────────────────────────────────────────────────────────────────

/** Por qué un ticket está donde está en su fila. */
export type MotivoOrden =
  /** Tiene prioridad fijada en Desk 2.0: va por delante (D1). */
  | 'prioridad'
  /** Primera etapa: por su fecha de remisión de entrada (D12). */
  | 'remision'
  /** Primera etapa, sin fecha de remisión: al final de los que sí la tienen. */
  | 'sin_remision'
  /** Por el momento, exacto, en que entró en su estado. */
  | 'llegada'
  /** No consta cuándo entró en su estado: por número de ticket. */
  | 'numero'
  /** Vuelve de standby: al final de la fila de su etapa. */
  | 'vuelta_standby';

export interface TicketEnFila {
  numero: number;
  estado: string;
  /** Desde 1. */
  posicion: number;
  motivo: MotivoOrden;
  /** `entrada`: espera en la fila de entrada; `en_etapa`: ya está en un estado de la etapa, sin puesto. */
  situacion: 'entrada' | 'en_etapa';
  flujo: FlujoAgenda;
  /** Días hábiles que ocupará un puesto; `null` = sin duración configurada. */
  duracionDias: number | null;
  /** Lo que da el reparto FIFO desde hoy; los tres `null` si no se puede prever. */
  puestoPrevisto: number | null;
  entradaPrevista: string | null;
  finPrevisto: string | null;
  marcas: {
    /** Falta `fecha_remision_entrada`: hay que escribirla en Zoho (D12). */
    faltaRemision: boolean;
    /** Sin tipo de servicio: usa la duración por defecto de la etapa (D9). */
    sinTipo: boolean;
    /** Su sitio lo decidió el número de ticket: no hay llegada exacta, o empata. */
    ordenAproximado: boolean;
    prioridad: boolean;
    /** Ni su tipo ni la «*» de la etapa tienen duración: sin fechas previstas. */
    sinDuracion: boolean;
  };
}

export interface PuestoAgenda {
  puesto: number;
  ocupante: {
    numero: number;
    /** `null` si el ticket no viene en la fuente. */
    estado: string | null;
    marcas: {
      sinTipo: boolean;
      sinDuracion: boolean;
      /** El ticket tiene puesto pero la fuente de ahora no lo trae (respaldo): se conserva. */
      sinDatosFuente: boolean;
    };
  } | null;
  inicio: string | null;
  finEstimado: string | null;
  /** Debía haber salido antes de hoy: sigue ocupando y se supone que sale el siguiente día hábil. */
  pasadoDeFecha: boolean;
  /** Está por encima de los puestos configurados: sigue ocupado hasta que su ticket salga y no recibe a nadie más. */
  aExtinguir: boolean;
}

/** Un equipo nuevo que llegará a esta etapa al acabar la anterior. Es previsión: el ticket está contado en su etapa de ahora. */
export interface TicketEncadenado {
  numero: number;
  /** El fin previsto en la etapa anterior. */
  llegadaPrevista: string;
  puestoPrevisto: number | null;
  entradaPrevista: string | null;
  finPrevisto: string | null;
}

export interface EtapaProyectada {
  etapa: EtapaAgenda;
  etiqueta: string;
  puestos: PuestoAgenda[];
  fila: TicketEnFila[];
  encadenados: TicketEncadenado[];
  /** `ocupados` puede superar `puestos` si se redujeron estando ocupados. */
  saturacion: { ocupados: number; puestos: number };
  /** El primer día con un puesto libre una vez repartida la fila; `null` si no se puede prever. */
  primerHueco: string | null;
}

export type CodigoAviso = 'sincronizacion_parada' | 'fuente_respaldo' | 'estados_sin_categoria';

export interface AgendaTaller {
  hoy: string;
  fuente: { fuente: NombreFuente; motivo: MotivoRespaldo | null; ultimaSincronizacion: string | null };
  /** En el orden configurado. */
  etapas: EtapaProyectada[];
  /** `dias`: días de calendario que lleva en ese estado; `null` si no consta cuándo entró. */
  standby: { numero: number; estado: string; desde: string | null; dias: number | null }[];
  porLlegar: { numero: number; estado: string }[];
  finTaller: number;
  fueraAgenda: number;
  /** Estados que no casan con ninguna categoría guardada ni del catálogo: hay que clasificarlos. */
  sinCategoria: { clave: string; estado: string; tickets: number[] }[];
  avisos: { codigo: CodigoAviso; mensaje: string }[];
  totalAbiertos: number;
}

// ── Orden de la fila ────────────────────────────────────────────────────────

/** D1: el rango de la prioridad fijada en Desk 2.0. Sin prioridad, o con una que no se conoce, 0. */
const RANGO_PRIORIDAD: ReadonlyMap<string, number> = new Map([
  ['urgent', 4],
  ['high', 3],
  ['medium', 2],
  ['low', 1],
]);

/** El único encadenado entre etapas: un equipo nuevo pasa de Proceso a Verificación sin standby en medio. */
const SIGUIENTE_EQUIPO_NUEVO: Partial<Record<EtapaAgenda, EtapaAgenda>> = { proceso: 'verificacion' };

interface Candidato {
  t: TicketTaller;
  estado: string;
  flujo: FlujoAgenda;
  situacion: 'entrada' | 'en_etapa';
}

type Clave = readonly (number | string)[];

function comparar(a: Clave, b: Clave): number {
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * El sitio de un ticket en la fila de `etapa` (F.3). Por este orden:
 *   0. prioridad fijada, de mayor a menor (sólo la de la fuente principal);
 *   1. grupo A —la primera etapa de su flujo, si no vuelve de standby— antes
 *      que el B —etapas siguientes y vueltas de standby—;
 *   A. con fecha de remisión antes que sin ella; la fecha; con el mismo día,
 *      llegada exacta antes que sin ella;
 *   B. llegada al estado (sin ella, detrás);
 *   y al final, siempre, el número de ticket.
 * Con `sinRemisiones` (respaldo sin la fecha en ningún ticket) el grupo A se
 * ordena como el B y nadie lleva la marca de la fecha (D8).
 */
function ordenDe(c: Candidato, etapa: EtapaAgenda, vuelve: boolean, sinRemisiones: boolean) {
  const rango = c.t.fuente === 'principal' ? (RANGO_PRIORIDAD.get(claveTipoServicio(c.t.prioridad)) ?? 0) : 0;
  const exacta = c.t.llegadaEstado !== null;
  const primera = etapa === etapaInicial(c.flujo) && !vuelve;
  const porRemision = primera && !sinRemisiones;
  const remision = c.t.remisionEntrada;
  const criterio: Clave = porRemision ? [0, remision ? 0 : 1, remision ?? '', exacta ? 0 : 1] : [primera ? 0 : 1, exacta ? 0 : 1, c.t.llegadaEstado ?? 0];
  const motivo: MotivoOrden = rango > 0 ? 'prioridad' : vuelve ? 'vuelta_standby' : porRemision ? (remision ? 'remision' : 'sin_remision') : exacta ? 'llegada' : 'numero';
  return {
    c,
    clave: [-rango, ...criterio, c.t.numero] as Clave,
    /** Lo que comparte con quien empata con él: entre ellos decide el número. */
    empate: JSON.stringify([rango, criterio]),
    motivo,
    prioridad: rango > 0,
    faltaRemision: porRemision && !remision,
    /** Sin fecha de remisión ya lleva su marca; sin llegada exacta el orden es aproximado aunque no empate. */
    aproximadoSiempre: !porRemision && !exacta,
    aproximadoSiEmpata: !porRemision || !!remision,
  };
}

// ── Reparto ─────────────────────────────────────────────────────────────────

/** Un puesto que puede recibir a alguien y el día en que queda libre. */
interface Libre {
  puesto: number;
  dia: string;
}

const SIN_PREVISION = { puestoPrevisto: null, entradaPrevista: null, finPrevisto: null };

/**
 * Da al siguiente de la fila el puesto que antes queda libre (en empate, el de
 * número menor: `libres` va por número) y lo deja ocupado hasta su fin. El día
 * en que sale uno entra el siguiente: el día de inicio no cuenta en la duración.
 */
function tomarPuesto(libres: Libre[], noAntesDe: string, dias: number | null, sumar: (desde: string, n: number) => string) {
  if (dias === null || libres.length === 0) return SIN_PREVISION;
  const libre = libres.reduce((m, x) => (x.dia < m.dia ? x : m));
  const entradaPrevista = libre.dia > noAntesDe ? libre.dia : noAntesDe;
  libre.dia = sumar(entradaPrevista, dias);
  return { puestoPrevisto: libre.puesto, entradaPrevista, finPrevisto: libre.dia };
}

const primerDia = (libres: readonly Libre[]): string | null => (libres.length ? libres.reduce((m, x) => (x.dia < m ? x.dia : m), libres[0].dia) : null);

/**
 * La agenda completa a fecha `hoy`.
 *
 * Sin asignaciones, todos los tickets de una etapa activa están en su fila y
 * la proyección simula el reparto FIFO desde hoy: es lo que propondrá el
 * «reparto inicial» (D6). Un ticket aparece en un solo sitio; `encadenados` es
 * previsión y repite tickets que ya están contados en su etapa de ahora.
 */
export function proyectarAgenda(e: EntradaAgenda): AgendaTaller {
  const { hoy } = e;
  const cierres = new Set(e.cierres);
  const sumar = (desde: string, n: number) => sumarDiasHabilesAgenda(desde, n, cierres);
  // D16: nada entra ni empieza en un día no hábil. Si hoy no lo es, se proyecta desde el siguiente que sí.
  const arranque = primerDiaHabilAgenda(hoy, cierres);
  const duracion = (numero: number, etapa: EtapaAgenda, t: TicketTaller | null) => duracionDeEtapa(e.config.duraciones, etapa, e.tiposManuales.get(numero), t?.tipoServicio);
  const tickets = [...e.tickets].sort((a, b) => a.numero - b.numero);
  const abiertos = new Set(tickets.map((t) => t.numero));
  const vuelven = new Set(e.vuelvenDeStandby ?? []);
  const sinRemisiones = tickets.every((t) => t.fuente === 'respaldo' && !t.remisionEntrada);

  // 1. Cada ticket, a su sitio según la categoría de su estado.
  const candidatos = new Map<EtapaAgenda, Candidato[]>(ETAPAS_AGENDA.map((etapa) => [etapa, []]));
  const standby: AgendaTaller['standby'] = [];
  const porLlegar: AgendaTaller['porLlegar'] = [];
  const sinCategoria = new Map<string, AgendaTaller['sinCategoria'][number]>();
  let finTaller = 0;
  let fueraAgenda = 0;
  for (const t of tickets) {
    const cat = categoriaDeEstado(t.estado, e.categorias);
    const estado = etiquetaEstadoDesk(t.estado);
    if (!cat) {
      const clave = claveEstadoDesk(t.estado);
      const grupo = sinCategoria.get(clave) ?? { clave, estado, tickets: [] };
      grupo.tickets.push(t.numero);
      sinCategoria.set(clave, grupo);
    } else if (cat.categoria === 'activa' || cat.categoria === 'entrada') {
      const flujo = e.flujosManuales?.get(t.numero) ?? flujoDeTicket(t).flujo;
      candidatos.get(cat.etapa ?? etapaInicial(flujo))!.push({ t, estado, flujo, situacion: cat.categoria === 'entrada' ? 'entrada' : 'en_etapa' });
    } else if (cat.categoria === 'standby') {
      const desde = t.llegadaEstado === null ? null : hoyEnColombia(new Date(t.llegadaEstado));
      standby.push({ numero: t.numero, estado, desde, dias: desde === null ? null : Math.max(0, diasEntre(desde, hoy)) });
    } else if (cat.categoria === 'por_llegar') porLlegar.push({ numero: t.numero, estado });
    else if (cat.categoria === 'fin') finTaller++;
    else fueraAgenda++;
  }

  // 2. Cada etapa: puestos ocupados, fila ordenada y reparto FIFO.
  const configuradas = [...e.config.etapas].sort((a, b) => a.orden - b.orden || ETAPAS_AGENDA.indexOf(a.etapa) - ETAPAS_AGENDA.indexOf(b.etapa));
  // Una etapa que falte en la configuración sale sin puestos: sus tickets no se pierden.
  const faltan = ETAPAS_AGENDA.filter((etapa) => !configuradas.some((c) => c.etapa === etapa)).map((etapa) => ({ etapa, etiqueta: ETIQUETA_ETAPA[etapa], orden: 0, puestos: 0 }));
  const conPuesto = new Set<number>();
  const libresDe = new Map<EtapaAgenda, Libre[]>();
  /** Los equipos nuevos que saldrán de cada etapa hacia la siguiente, con su fin previsto. */
  const salidas = new Map<EtapaAgenda, { t: TicketTaller; fin: string }[]>();

  const etapas = [...configuradas, ...faltan].map((cfg): EtapaProyectada => {
    const { etapa } = cfg;
    const suyos = candidatos.get(etapa)!;
    const porNumero = new Map(suyos.map((c) => [c.t.numero, c]));
    const sale = (c: Candidato | undefined, fin: string | null) => {
      const siguiente = SIGUIENTE_EQUIPO_NUEVO[etapa];
      if (c && fin !== null && siguiente && c.flujo === 'equipo_nuevo') salidas.set(siguiente, [...(salidas.get(siguiente) ?? []), { t: c.t, fin }]);
    };

    // Asignaciones vigentes de la etapa. Manda el estado del ticket: si la fuente lo trae y ya no está en
    // esta etapa, la asignación no cuenta (el lote 4 la cerrará). Si la fuente no lo trae, conserva el puesto.
    const ocupados = new Map<number, AsignacionAgenda>();
    for (const a of e.asignaciones) {
      if (a.etapa !== etapa || ocupados.has(a.puesto) || conPuesto.has(a.numero)) continue;
      if (!porNumero.has(a.numero) && abiertos.has(a.numero)) continue;
      ocupados.set(a.puesto, a);
      conPuesto.add(a.numero);
    }
    const numeros = [...new Set([...Array.from({ length: cfg.puestos }, (_, i) => i + 1), ...ocupados.keys()])].sort((a, b) => a - b);
    const libres: Libre[] = [];
    const puestos = numeros.map((puesto): PuestoAgenda => {
      const a = ocupados.get(puesto);
      const aExtinguir = puesto > cfg.puestos;
      if (!a) {
        libres.push({ puesto, dia: arranque });
        return { puesto, ocupante: null, inicio: null, finEstimado: null, pasadoDeFecha: false, aExtinguir };
      }
      const c = porNumero.get(a.numero);
      const d = duracion(a.numero, etapa, c?.t ?? null);
      const fin = d.dias === null ? null : sumar(a.desde, d.dias);
      // Pasado de fecha: sigue ocupando y se supone que sale el siguiente día hábil (regla 6).
      const pasadoDeFecha = fin !== null && fin < hoy;
      const finEstimado = pasadoDeFecha ? sumar(hoy, 1) : fin;
      if (finEstimado !== null && !aExtinguir) libres.push({ puesto, dia: finEstimado });
      sale(c, finEstimado);
      return {
        puesto,
        ocupante: { numero: a.numero, estado: c?.estado ?? null, marcas: { sinTipo: d.sinTipo, sinDuracion: d.dias === null, sinDatosFuente: !c } },
        inicio: a.desde,
        finEstimado,
        pasadoDeFecha,
        aExtinguir,
      };
    });

    const ordenados = suyos
      .filter((c) => !conPuesto.has(c.t.numero))
      .map((c) => ordenDe(c, etapa, c.situacion === 'en_etapa' && vuelven.has(c.t.numero), sinRemisiones))
      .sort((a, b) => comparar(a.clave, b.clave));
    const empatados = new Map<string, number>();
    for (const o of ordenados) empatados.set(o.empate, (empatados.get(o.empate) ?? 0) + 1);
    const fila = ordenados.map((o, i): TicketEnFila => {
      const d = duracion(o.c.t.numero, etapa, o.c.t);
      const previsto = tomarPuesto(libres, arranque, d.dias, sumar);
      sale(o.c, previsto.finPrevisto);
      return {
        numero: o.c.t.numero,
        estado: o.c.estado,
        posicion: i + 1,
        motivo: o.motivo,
        situacion: o.c.situacion,
        flujo: o.c.flujo,
        duracionDias: d.dias,
        ...previsto,
        marcas: {
          faltaRemision: o.faltaRemision,
          sinTipo: d.sinTipo,
          ordenAproximado: o.aproximadoSiempre || (o.aproximadoSiEmpata && empatados.get(o.empate)! > 1),
          prioridad: o.prioridad,
          sinDuracion: d.dias === null,
        },
      };
    });
    libresDe.set(etapa, libres);
    return { etapa, etiqueta: cfg.etiqueta, puestos, fila, encadenados: [], saturacion: { ocupados: ocupados.size, puestos: cfg.puestos }, primerHueco: primerDia(libres) };
  });

  // 3. Cadena de equipo nuevo: quien acaba una etapa llega a la siguiente ese día, detrás de la fila que ya hay.
  for (const x of etapas) {
    const llegan = [...(salidas.get(x.etapa) ?? [])].sort((a, b) => comparar([a.fin], [b.fin]));
    x.encadenados = llegan.map(({ t, fin }) => ({ numero: t.numero, llegadaPrevista: fin, ...tomarPuesto(libresDe.get(x.etapa)!, fin, duracion(t.numero, x.etapa, t).dias, sumar) }));
  }

  // 4. Avisos globales: no marcan ningún ticket ni cambian nada de lo anterior (D13).
  const f = e.estadoFuente;
  const respaldo = f.fuente === 'respaldo' || tickets.some((t) => t.fuente === 'respaldo');
  const sinCat = [...sinCategoria.values()].sort((a, b) => comparar([a.clave], [b.clave]));
  const avisos: AgendaTaller['avisos'] = [];
  if (f.sincronizacionParada) {
    avisos.push({ codigo: 'sincronizacion_parada', mensaje: `La sincronización de la fuente lleva más de ${Math.round(f.umbralSincronizacionMs / 60_000)} minutos parada: los estados pueden no estar al día.` });
  }
  if (respaldo) avisos.push({ codigo: 'fuente_respaldo', mensaje: f.mensaje ?? 'Se está leyendo la réplica de Zoho (respaldo), no Desk 2.0.' });
  if (sinCat.length) {
    const n = sinCat.reduce((s, g) => s + g.tickets.length, 0);
    avisos.push({ codigo: 'estados_sin_categoria', mensaje: `Hay ${sinCat.length} ${sinCat.length === 1 ? 'estado' : 'estados'} sin categoría en la agenda (${n} ${n === 1 ? 'ticket' : 'tickets'}): hay que clasificarlos en Configuración.` });
  }

  return {
    hoy,
    fuente: { fuente: respaldo ? 'respaldo' : 'principal', motivo: f.motivo, ultimaSincronizacion: f.ultimaSincronizacion },
    etapas,
    standby,
    porLlegar,
    finTaller,
    fueraAgenda,
    sinCategoria: sinCat,
    avisos,
    totalAbiertos: tickets.length,
  };
}

// ── Lote 4: la vuelta de standby y el reparto inicial ───────────────────────

/** Un tramo del historial de un ticket (portal.tmc_estados_historial): estado normalizado e instantes en milisegundos. */
export interface TramoHistorial {
  clave: string;
  desde: number;
  /** Null = sigue en ese estado. */
  hasta: number | null;
}

/**
 * Los tickets que VUELVEN de un standby (B.5): están en una etapa activa y, justo
 * antes de entrar en ella, el historial los tiene en un estado de categoría
 * standby. Un cambio de estado dentro de la misma etapa («Rev./Diagnostico» →
 * «Notificado») no borra la vuelta. Sólo se afirma con el historial en la
 * mano: si su tramo abierto no es el estado que da la fuente, o hay un hueco
 * antes de la etapa, el ticket no cuenta como vuelto. Por número.
 */
export function vuelvenDeStandby(tickets: readonly TicketTaller[], historial: { get(numero: number): readonly TramoHistorial[] | undefined }, categorias: EntradaAgenda['categorias']): number[] {
  const vuelven: number[] = [];
  for (const t of tickets) {
    const etapa = categoriaDeEstado(t.estado, categorias)?.etapa ?? null;
    const tramos = [...(historial.get(t.numero) ?? [])].sort((a, b) => a.desde - b.desde);
    let i = tramos.length - 1;
    if (etapa === null || i < 1 || tramos[i].hasta !== null || tramos[i].clave !== claveEstadoDesk(t.estado)) continue;
    const pegado = () => tramos[i - 1].hasta === tramos[i].desde;
    while (i > 0 && pegado() && categoriaDeEstado(tramos[i - 1].clave, categorias)?.etapa === etapa) i--;
    if (i > 0 && pegado() && categoriaDeEstado(tramos[i - 1].clave, categorias)?.categoria === 'standby') vuelven.push(t.numero);
  }
  return vuelven.sort((a, b) => a - b);
}

/** Una línea del reparto inicial: qué ticket va a qué puesto y desde qué día cuenta su duración. */
export interface ItemReparto {
  numero: number;
  etapa: EtapaAgenda;
  puesto: number;
  desde: string;
}

/**
 * El reparto inicial que se propone (D6, F.5): en cada etapa, los puestos
 * libres por número para los tickets que YA están en un estado de la etapa,
 * en el orden de su fila. Quien espera en la fila de entrada no se propone, y
 * lo que no cabe queda en la fila. La duración cuenta desde la llegada exacta
 * a la etapa si consta y, si no, desde hoy; nunca desde un día no hábil (D16).
 * No escribe nada: es la misma proyección, leída de otra forma.
 */
export function proponerReparto(e: EntradaAgenda): ItemReparto[] {
  return proyectarAgenda(e).etapas.flatMap((x) => {
    const libres = x.puestos.filter((p) => p.ocupante === null && !p.aExtinguir);
    return x.fila
      .filter((t) => t.situacion === 'en_etapa')
      .slice(0, libres.length)
      .map((t, i) => ({ numero: t.numero, etapa: x.etapa, puesto: libres[i].puesto, desde: inicioDeReparto(e, t.numero) }));
  });
}

/** El día desde el que cuenta la duración de un ticket en el reparto inicial: su llegada exacta al estado, o hoy; siempre hábil. */
export function inicioDeReparto(e: EntradaAgenda, numero: number): string {
  const ms = e.tickets.find((t) => t.numero === numero)?.llegadaEstado ?? null;
  return primerDiaHabilAgenda(ms === null ? e.hoy : hoyEnColombia(new Date(ms)), new Set(e.cierres));
}
