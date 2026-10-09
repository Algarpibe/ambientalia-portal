/**
 * Dominio de «Trazabilidad Mantenimientos Clientes» (GRIMM EDM 180).
 *
 * Puro: sin imports, sin Node, sin BD, sin UI. Lo usa el servidor para
 * clasificar y la app del portal lo importa por ruta relativa para pintar el
 * mismo estado sin repetir la regla (mismo patrón que el motor O3 de
 * calibraciones). `dominio.test.ts` vigila que no gane imports.
 *
 * La regla de vigencia es la de la hoja F-ST-022 «Trazabilidad Mttos Clientes»:
 *   Vigencia calibración (días) = (Última calibración − HOY) + 365
 * y la columna «Estado» de esa hoja marca 1 cuando la vigencia es < −365.
 */

/** Días de validez de una calibración (columna AD de la F-ST-022). */
export const VIGENCIA_DIAS = 365;

/** Umbrales del aviso escalonado (días de vigencia restantes). */
export const UMBRALES = { aviso30: 30, aviso60: 60, aviso90: 90 } as const;

export type EstadoCalibracion =
  | 'FUERA_CICLO' // vencida hace más de un año: la F-ST-022 la marca con Estado = 1
  | 'VENCIDA' // vencida en el último año: susceptible de llegada urgente
  | 'VENCE_30'
  | 'VENCE_60'
  | 'VENCE_90'
  | 'AL_DIA'
  | 'SIN_FECHA';

/** Orden de presentación: de lo más urgente a lo que no pide nada. */
export const ESTADOS: readonly EstadoCalibracion[] = [
  'FUERA_CICLO',
  'VENCIDA',
  'VENCE_30',
  'VENCE_60',
  'VENCE_90',
  'AL_DIA',
  'SIN_FECHA',
];

export const ETIQUETA_ESTADO: Record<EstadoCalibracion, string> = {
  FUERA_CICLO: 'Vencida +1 año',
  VENCIDA: 'Vencida',
  VENCE_30: 'Vence ≤ 30 días',
  VENCE_60: 'Vence 31–60 días',
  VENCE_90: 'Vence 61–90 días',
  AL_DIA: 'Al día',
  SIN_FECHA: 'Sin fecha',
};

/** Estados que piden aviso previo al cliente (o llegada urgente). */
export const ESTADOS_AVISO: readonly EstadoCalibracion[] = ['VENCIDA', 'VENCE_30', 'VENCE_60', 'VENCE_90'];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True si `s` es una fecha de calendario real en formato AAAA-MM-DD. */
export function esFechaIso(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function aUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** `iso` + `n` días, en AAAA-MM-DD (aritmética en UTC: sin saltos de horario). */
export function sumarDias(iso: string, n: number): string {
  return new Date(aUtc(iso) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Días de `desde` a `hasta` (positivo si `hasta` es posterior). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta) - aUtc(desde)) / 86_400_000);
}

export interface EstadoEquipo {
  /** Fecha en que se cumple la vigencia (última calibración + 365 días). */
  vence: string | null;
  /** Días de vigencia restantes; negativo = vencida hace N días. */
  vigenciaDias: number | null;
  estado: EstadoCalibracion;
}

/** Clasifica un equipo según su última calibración, a fecha `hoy` (AAAA-MM-DD). */
export function estadoCalibracion(ultimaCalibracion: string | null, hoy: string): EstadoEquipo {
  if (!ultimaCalibracion || !esFechaIso(ultimaCalibracion)) return { vence: null, vigenciaDias: null, estado: 'SIN_FECHA' };
  const vence = sumarDias(ultimaCalibracion, VIGENCIA_DIAS);
  const v = diasEntre(hoy, vence);
  const estado: EstadoCalibracion =
    v < -VIGENCIA_DIAS
      ? 'FUERA_CICLO'
      : v < 0
        ? 'VENCIDA'
        : v <= UMBRALES.aviso30
          ? 'VENCE_30'
          : v <= UMBRALES.aviso60
            ? 'VENCE_60'
            : v <= UMBRALES.aviso90
              ? 'VENCE_90'
              : 'AL_DIA';
  return { vence, vigenciaDias: v, estado };
}

/**
 * Normaliza el modelo tal como viene escrito en la hoja («EDM 180C»,
 * «EDM180C», «edm 180 d»…) y devuelve «EDM 180C» / «EDM 180D», o null si no
 * es un EDM 180 (el EDM 280, el 1109 o el WS600 quedan fuera).
 */
export function modeloEdm180(modelo: unknown): string | null {
  const m = String(modelo ?? '').toUpperCase().replace(/\s+/g, '');
  if (!m.startsWith('EDM180')) return null;
  return `EDM 180${m.slice(6)}`;
}

/** Un serial convertido en clave estable (letras, dígitos, _ y -). */
export function claveSerial(serial: string): string {
  return serial.trim().replace(/[^A-Za-z0-9_-]/g, '_');
}

/** El serial tal como casa con Desk: sin espacios alrededor y en mayúsculas (lo mismo que `upper(trim(…))` en SQL). */
export function serialNorm(serial: unknown): string {
  return String(serial ?? '').trim().toUpperCase();
}

/**
 * Asigna una clave estable a cada fila. La F-ST-022 repite algún serial en dos
 * clientes (p. ej. 18A00004); la primera aparición se queda con el serial y las
 * siguientes llevan sufijo «-2», «-3», en el orden de la hoja.
 */
export function asignarClaves(seriales: readonly string[]): string[] {
  const visto = new Map<string, number>();
  return seriales.map((s) => {
    const base = claveSerial(s);
    const n = (visto.get(base) ?? 0) + 1;
    visto.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

// ── Servicios abiertos en Zoho Desk y su plazo ──────────────────────────────
//
// La pestaña «Servicios» pone a cada ticket abierto una fecha límite: ingreso +
// N días hábiles, con N según el tipo de servicio. Aquí sólo va lo que no
// necesita calendario de festivos (eso es de servidor: plazos.ts).

export type EstadoPlazo =
  | 'VENCIDO' // la fecha límite ya pasó
  | 'VENCE_HOY'
  | 'EN_PLAZO'
  | 'SIN_PLAZO' // sin tipo de servicio, o su tipo no tiene plazo configurado
  // Los tres del trabajo terminado: el reloj está parado y ya no se vence.
  | 'INCUMPLIDO' // llegó a «trabajo terminado» después de la fecha límite
  | 'CUMPLIDO' // llegó a «trabajo terminado» a tiempo
  | 'TERMINADO'; // está terminado, pero el portal no vio cuándo: no se puede medir

/**
 * Orden de presentación: de lo más urgente a lo que no pide nada. Primero lo
 * que sigue en marcha; detrás, lo que ya tiene el trabajo terminado.
 */
export const ESTADOS_PLAZO: readonly EstadoPlazo[] = ['VENCIDO', 'VENCE_HOY', 'EN_PLAZO', 'SIN_PLAZO', 'INCUMPLIDO', 'CUMPLIDO', 'TERMINADO'];

/** Los estados del plazo de un ticket con el trabajo terminado (reloj parado). */
export const ESTADOS_PLAZO_TERMINADO: readonly EstadoPlazo[] = ['INCUMPLIDO', 'CUMPLIDO', 'TERMINADO'];

/** True si el estado del plazo es uno de los del trabajo terminado. */
export function esPlazoTerminado(e: EstadoPlazo): boolean {
  return ESTADOS_PLAZO_TERMINADO.includes(e);
}

export const ETIQUETA_PLAZO: Record<EstadoPlazo, string> = {
  VENCIDO: 'Vencido',
  VENCE_HOY: 'Vence hoy',
  EN_PLAZO: 'En plazo',
  SIN_PLAZO: 'Sin plazo',
  INCUMPLIDO: 'Incumplido',
  CUMPLIDO: 'Cumplido',
  TERMINADO: 'Terminado',
};

/** Límites de un plazo configurable, en días hábiles. */
export const PLAZO_MIN_DIAS = 1;
export const PLAZO_MAX_DIAS = 365;

/** Cuántos días hacia atrás desde hoy enseña como mucho el calendario de barras. */
export const RETROCESO_MAX_DIAS = 60;

/**
 * Clave con la que casa un tipo de servicio: sin mayúsculas, sin tildes y sin
 * espacios de más («Diagnostico», «diagnóstico» y « Diagnóstico » son la
 * misma). Vacía si no hay tipo.
 */
export function claveTipoServicio(tipo: unknown): string {
  return String(tipo ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tipos de servicio COMPUESTOS: clave del tipo → claves de sus partes, en el
 * orden en que se hacen. El plazo de un compuesto no se guarda en ningún
 * sitio: es la suma, en vivo, de los plazos de sus partes (`diasDeTipo`), así
 * que cambiar el de una parte en Configuración cambia el suyo sin más. Si a
 * una parte le falta el plazo, el compuesto queda «sin plazo».
 *
 * Éste es el ÚNICO sitio donde se define la composición. Las claves van ya
 * normalizadas (`claveTipoServicio`: «Diagnóstico + Calibración» →
 * «diagnostico + calibracion») y una parte no puede ser otro compuesto;
 * `dominio.test.ts` vigila las dos cosas. La fila del compuesto en
 * portal.tmc_plazos la siembra la migración 045 (sólo para que se pueda elegir
 * y salga en Configuración); su `dias_habiles` no se lee.
 */
export const TIPOS_COMPUESTOS: Readonly<Record<string, readonly string[]>> = {
  'diagnostico + calibracion': ['diagnostico', 'calibracion'],
};

/** Las claves de las partes de un tipo compuesto, o null si `clave` es un tipo simple. */
export function partesDeTipo(clave: string): readonly string[] | null {
  return Object.prototype.hasOwnProperty.call(TIPOS_COMPUESTOS, clave) ? TIPOS_COMPUESTOS[clave] : null;
}

/**
 * El plazo, en días hábiles, que vale para un tipo: el suyo si es simple y, si
 * es compuesto, la suma de los de sus partes (null en cuanto a una le falte).
 * `guardados` da el plazo configurado de cada clave (un Map vale). Todo el que
 * necesite los días de un tipo pasa por aquí: lista, fecha límite, contadores,
 * Configuración y el desplegable salen del mismo número.
 */
export function diasDeTipo(clave: string, guardados: { get(clave: string): number | null | undefined }): number | null {
  const partes = partesDeTipo(clave);
  if (!partes) return guardados.get(clave) ?? null;
  let total = 0;
  for (const p of partes) {
    const d = guardados.get(p) ?? null;
    if (d === null) return null;
    total += d;
  }
  return total;
}

/**
 * Un tramo del plazo de un servicio de tipo compuesto: la parte que lo ocupa,
 * sus días hábiles y el día en que acaba. Los calcula el servidor (plazos.ts),
 * uno detrás de otro desde el ingreso; el último acaba en la fecha límite.
 */
export interface TramoPlazo {
  /** Clave de la parte («diagnostico»). */
  clave: string;
  etiqueta: string;
  dias: number;
  /** Último día del tramo (AAAA-MM-DD). */
  hasta: string;
}

/** De dónde sale el tipo de servicio de un ticket: puesto a mano en la app, o el que trae Desk. */
export type OrigenTipo = 'manual' | 'desk';

/**
 * El tipo de servicio que vale para un ticket. El puesto a mano en la app
 * GANA al que traiga Desk; sin él, vale el de Desk; sin ninguno, queda vacío y
 * sin origen («sin tipo»). Con este tipo se busca el plazo.
 */
export function tipoEfectivo(manual: unknown, desk: unknown): { tipo: string; origen: OrigenTipo | null } {
  const m = String(manual ?? '').trim();
  if (m) return { tipo: m, origen: 'manual' };
  const d = String(desk ?? '').trim();
  return d ? { tipo: d, origen: 'desk' } : { tipo: '', origen: null };
}

/**
 * Modelo del equipo: el tercer tramo del código de servicio
 * («MT_18A00001_EDM180C_261002» → «EDM180C»). La réplica no lo trae en columna.
 */
export function modeloDeCodigo(codigo: unknown): string {
  return String(codigo ?? '').split('_')[2]?.trim() ?? '';
}

/**
 * El asunto del ticket sin el código de servicio: lo que se enseña como
 * cliente cuando Desk no manda la cuenta. Si el código no viene en su columna,
 * se quita lo que tenga su forma (tres o más tramos unidos por «_»).
 */
export function asuntoSinCodigo(asunto: unknown, codigo: unknown): string {
  let a = String(asunto ?? '');
  const c = String(codigo ?? '').trim();
  if (c) a = a.split(c).join(' ');
  return a
    .replace(/\S+_\S+_\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Estados de Zoho Desk y su rol en el reloj del plazo ─────────────────────
//
// En «Configuración» cada estado de Desk tiene un rol, y sólo uno:
//   · cuenta    — el tiempo en ese estado corre (el de partida);
//   · standby   — reloj en PAUSA: el ticket depende de una decisión del cliente
//                 o de un servicio externo; esos días hábiles no cuentan;
//   · terminado — reloj PARADO: el trabajo técnico está hecho («Por Facturar»,
//                 «Por Entregar»); el ticket se juzga por el día en que llegó.
// Cuánto tiempo pasó el ticket en cada estado lo mide el propio portal, que
// apunta los cambios que ve (portal.tmc_estados_historial); el cálculo, con el
// calendario de festivos, es de servidor (plazos.ts).

/** El rol de un estado de Desk en el reloj del plazo. */
export type RolEstado = 'cuenta' | 'standby' | 'terminado';

/** Los tres roles, en el orden en que se ofrecen. Son los valores de `portal.tmc_estados_desk.rol`. */
export const ROLES_ESTADO: readonly RolEstado[] = ['cuenta', 'standby', 'terminado'];

/** El rol de un estado que nadie ha tocado: su tiempo cuenta. */
export const ROL_POR_DEFECTO: RolEstado = 'cuenta';

export const ETIQUETA_ROL: Record<RolEstado, string> = {
  cuenta: 'Cuenta',
  standby: 'Standby',
  terminado: 'Trabajo terminado',
};

/** True si `v` es, tal cual, uno de los tres roles. */
export function esRolEstado(v: unknown): v is RolEstado {
  return typeof v === 'string' && (ROLES_ESTADO as readonly string[]).includes(v);
}

/**
 * True si un día que acaba en un estado con este rol no cuenta para el plazo.
 * Standby lo pausa; «terminado» también, para el ticket que después vuelve a
 * un estado que cuenta: el tiempo que pasó con el trabajo dado por hecho no se
 * le carga.
 */
export function rolPausaReloj(rol: RolEstado): boolean {
  return rol !== 'cuenta';
}

/** Un rango de fechas de calendario, ambas incluidas (AAAA-MM-DD). */
export interface RangoFechas {
  desde: string;
  hasta: string;
}

/**
 * El veredicto de un ticket con el trabajo terminado: cumplió si llegó a ese
 * estado (`terminadoEl`) no más tarde que su fecha límite. Si el portal no vio
 * el cambio (`medible` false: ya estaba terminado la primera vez que lo vio) no
 * se sabe desde cuándo lo está, y queda en TERMINADO a secas. Sin fecha límite
 * no hay con qué comparar.
 */
export function veredictoTerminado(terminadoEl: string, fechaLimite: string | null, medible: boolean): EstadoPlazo {
  if (!fechaLimite) return 'SIN_PLAZO';
  if (!medible) return 'TERMINADO';
  return terminadoEl <= fechaLimite ? 'CUMPLIDO' : 'INCUMPLIDO';
}

/**
 * Clave con la que casa un estado de Desk: la misma normalización que la de los
 * tipos de servicio (sin mayúsculas, sin tildes y sin espacios repetidos ni
 * sobrantes), así que «Notificación  Comercial» y «notificacion comercial» son
 * el mismo estado. Vacía si no hay estado.
 */
export function claveEstadoDesk(estado: unknown): string {
  return claveTipoServicio(estado);
}

/** El estado tal como se enseña: como lo escribe Desk, sin espacios repetidos ni sobrantes. */
export function etiquetaEstadoDesk(estado: unknown): string {
  return String(estado ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Los tipos de estado de Desk (`status_type`), en el orden en que se listan. Cualquier otro valor (o ninguno) va al final. */
export const TIPOS_ESTADO_DESK: readonly string[] = ['Open', 'On Hold', 'Closed'];

const rangoTipoEstado = (tipo: string | null): number => {
  const i = tipo === null ? -1 : TIPOS_ESTADO_DESK.indexOf(tipo);
  return i < 0 ? TIPOS_ESTADO_DESK.length : i;
};

/**
 * El orden del bloque «Estados de Desk»: primero los de tipo abierto, después
 * los de espera y los cerrados; dentro de cada grupo, el que más tickets
 * abiertos tiene y, a igualdad, por orden alfabético.
 */
export function porOrdenEstadosDesk(
  a: { tipoDesk: string | null; ticketsAbiertos: number; etiqueta: string },
  b: { tipoDesk: string | null; ticketsAbiertos: number; etiqueta: string },
): number {
  return rangoTipoEstado(a.tipoDesk) - rangoTipoEstado(b.tipoDesk) || b.ticketsAbiertos - a.ticketsAbiertos || a.etiqueta.localeCompare(b.etiqueta, 'es');
}

/**
 * Clasifica por su fecha límite, a fecha `hoy` (AAAA-MM-DD), un servicio que
 * sigue en marcha. Los del trabajo terminado los decide `veredictoTerminado`.
 */
export function estadoPlazo(fechaLimite: string | null, hoy: string): EstadoPlazo {
  if (!fechaLimite) return 'SIN_PLAZO';
  return fechaLimite < hoy ? 'VENCIDO' : fechaLimite === hoy ? 'VENCE_HOY' : 'EN_PLAZO';
}

// ── Agenda del taller: configuración ────────────────────────────────────────
//
// Cada estado de Desk tiene, además de su rol en el reloj, una CATEGORÍA en la
// agenda (y, si es una etapa activa, su ETAPA). Son dos cosas distintas con
// dos usos: el rol gobierna el plazo de «Servicios»; la categoría, los puestos
// y las filas del taller. Se guardan en columnas distintas de
// portal.tmc_estados_desk y ninguna de las dos cambia a la otra.
// Decisiones (D1…D14) y propuesta de partida: docs/trazabilidad-agenda-taller.md.

/** La categoría de un estado en la agenda. Son los valores de `portal.tmc_estados_desk.categoria`. */
export const CATEGORIAS_AGENDA = ['por_llegar', 'entrada', 'activa', 'standby', 'fin', 'fuera'] as const;
export type CategoriaAgenda = (typeof CATEGORIAS_AGENDA)[number];

export const ETIQUETA_CATEGORIA: Record<CategoriaAgenda, string> = {
  por_llegar: 'Por llegar',
  entrada: 'Fila de entrada',
  activa: 'Etapa activa',
  standby: 'Standby',
  fin: 'Fin de taller',
  fuera: 'Fuera de la agenda',
};

/** Las etapas del taller, en su orden. Son los valores de `etapa` en portal.tmc_estados_desk y en las tablas tmc_agenda_*. */
export const ETAPAS_AGENDA = ['diagnostico', 'proceso', 'verificacion'] as const;
export type EtapaAgenda = (typeof ETAPAS_AGENDA)[number];

export const ETIQUETA_ETAPA: Record<EtapaAgenda, string> = {
  diagnostico: 'Diagnóstico',
  proceso: 'Proceso',
  verificacion: 'Verificación',
};

/** Tope de puestos simultáneos de una etapa (el `CHECK` de portal.tmc_agenda_etapas). */
export const PUESTOS_MAX = 50;

export function esCategoriaAgenda(v: unknown): v is CategoriaAgenda {
  return typeof v === 'string' && (CATEGORIAS_AGENDA as readonly string[]).includes(v);
}

export function esEtapaAgenda(v: unknown): v is EtapaAgenda {
  return typeof v === 'string' && (ETAPAS_AGENDA as readonly string[]).includes(v);
}

/** La categoría de un estado y, sólo si es una etapa activa, cuál. */
export interface CategoriaEstado {
  categoria: CategoriaAgenda;
  etapa: EtapaAgenda | null;
}

/** Sólo una etapa activa lleva etapa, y la lleva siempre (el mismo `CHECK` de la migración 050). */
export function categoriaCoherente(categoria: CategoriaAgenda, etapa: EtapaAgenda | null): boolean {
  return (categoria === 'activa') === (etapa !== null);
}

/**
 * La propuesta de partida (sección C.3 del análisis): los 23 estados del
 * blueprint de Desk. Es lo que siembra la migración 050 donde nadie ha elegido
 * todavía (agenda-config.test.ts vigila que coincidan). «Notificado» sigue
 * ocupando puesto, dentro de Diagnóstico (D2); «Pendiente» y «Solicitud
 * Soporte», soporte remoto, quedan fuera (D10).
 */
export const CATALOGO_ESTADOS_AGENDA: readonly ({ estado: string } & CategoriaEstado)[] = [
  { estado: 'OV asignada', categoria: 'por_llegar', etapa: null },
  { estado: 'Ticket creado', categoria: 'por_llegar', etapa: null },
  { estado: 'Remisión creada', categoria: 'entrada', etapa: null },
  { estado: 'Ingresado', categoria: 'entrada', etapa: null },
  { estado: 'Rev./Diagnostico', categoria: 'activa', etapa: 'diagnostico' },
  { estado: 'Notificado', categoria: 'activa', etapa: 'diagnostico' },
  { estado: 'En Proceso', categoria: 'activa', etapa: 'proceso' },
  { estado: 'Continuación del proceso', categoria: 'activa', etapa: 'proceso' },
  { estado: 'Verificación', categoria: 'activa', etapa: 'verificacion' },
  { estado: 'Notificación a Compras', categoria: 'standby', etapa: null },
  { estado: 'Notificación Comercial', categoria: 'standby', etapa: null },
  { estado: 'Notificación cliente', categoria: 'standby', etapa: null },
  { estado: 'En espera de SKU inventario', categoria: 'standby', etapa: null },
  { estado: 'En Espera de Repuestos', categoria: 'standby', etapa: null },
  { estado: 'Solicitado', categoria: 'standby', etapa: null },
  { estado: 'Servicio externo', categoria: 'standby', etapa: null },
  { estado: 'Por Facturar', categoria: 'fin', etapa: null },
  { estado: 'Liberación Comercial', categoria: 'fin', etapa: null },
  { estado: 'Por Entregar', categoria: 'fin', etapa: null },
  { estado: 'Por Entregar / Sin facturar', categoria: 'fin', etapa: null },
  { estado: 'Finalizado', categoria: 'fin', etapa: null },
  { estado: 'Pendiente', categoria: 'fuera', etapa: null },
  { estado: 'Solicitud Soporte', categoria: 'fuera', etapa: null },
];

const CATALOGO_POR_CLAVE: ReadonlyMap<string, CategoriaEstado> = new Map(
  CATALOGO_ESTADOS_AGENDA.map((e) => [claveEstadoDesk(e.estado), { categoria: e.categoria, etapa: e.etapa }]),
);

/**
 * La categoría (y la etapa) de un estado en la agenda. Casa por
 * `claveEstadoDesk`. Lo guardado en Configuración (`guardadas`, por clave)
 * GANA; sin nada guardado vale la propuesta de partida; un estado que no está
 * en ninguno de los dos sitios queda sin categoría (`null`): la agenda no sabe
 * dónde ponerlo hasta que alguien se la elija.
 */
export function categoriaDeEstado(estado: unknown, guardadas?: { get(clave: string): CategoriaEstado | null | undefined }): CategoriaEstado | null {
  const clave = claveEstadoDesk(estado);
  if (!clave) return null;
  const c = guardadas?.get(clave) ?? CATALOGO_POR_CLAVE.get(clave);
  return c ? { categoria: c.categoria, etapa: c.etapa } : null;
}

/** El flujo de un ticket en el taller: un equipo que viene a servicio, o un equipo nuevo. */
export const FLUJOS_AGENDA = ['servicio', 'equipo_nuevo'] as const;
export type FlujoAgenda = (typeof FLUJOS_AGENDA)[number];

const CLASIFICACION_EQUIPO_NUEVO = 'equipo nuevo';

/**
 * El flujo de un ticket (D11) y si hubo que deducirlo.
 *
 * Con clasificación (`classification` de Desk 2.0) manda ella: equipo nuevo si
 * normaliza a «equipo nuevo», y servicio con cualquier otra. Sin ella, la
 * fuente principal da servicio; el respaldo —cuya réplica la trae vacía— lo
 * DEDUCE: equipo nuevo si el asunto empieza por «Equipo Nuevo» o el código de
 * servicio por `HV_`. La marca a mano por ticket (portal.tmc_agenda_flujo) no
 * pasa por aquí: sólo existe para el ticket sin clasificación y la aplica la
 * proyección (`flujosManuales`).
 */
export function flujoDeTicket(t: {
  fuente: 'principal' | 'respaldo';
  clasificacion: string | null;
  asunto: string | null;
  codigoServicio: string | null;
}): { flujo: FlujoAgenda; deducido: boolean } {
  const clasificacion = claveTipoServicio(t.clasificacion);
  if (clasificacion || t.fuente === 'principal') {
    return { flujo: clasificacion === CLASIFICACION_EQUIPO_NUEVO ? 'equipo_nuevo' : 'servicio', deducido: false };
  }
  const nuevo = claveTipoServicio(t.asunto).startsWith(CLASIFICACION_EQUIPO_NUEVO) || /^HV_/i.test(String(t.codigoServicio ?? '').trim());
  return { flujo: nuevo ? 'equipo_nuevo' : 'servicio', deducido: true };
}

/** La primera etapa de un ticket: Diagnóstico si viene a servicio; un equipo nuevo entra directo a Proceso. */
export function etapaInicial(flujo: FlujoAgenda): EtapaAgenda {
  return flujo === 'equipo_nuevo' ? 'proceso' : 'diagnostico';
}

/** El «tipo» de la fila por defecto de una etapa en portal.tmc_agenda_duraciones (D9). */
export const TIPO_POR_DEFECTO = '*';

/** Cuántos días hábiles ocupa un puesto de `etapa` un servicio de ese tipo (clave de tipo, o «*»). */
export interface DuracionEtapa {
  etapa: EtapaAgenda;
  tipo: string;
  dias: number;
}

/**
 * La duración de una etapa para un ticket (D9): la fila exacta de su tipo; si
 * no la hay, la «*» de la etapa; si tampoco, sin duración (`dias` null). El
 * tipo es el efectivo —el puesto a mano gana al de la fuente (`tipoEfectivo`)—
 * y casa por `claveTipoServicio`. Sin tipo se usa la «*» y se marca `sinTipo`.
 */
export function duracionDeEtapa(
  duraciones: readonly DuracionEtapa[],
  etapa: EtapaAgenda,
  tipoManual: unknown,
  tipoFuente: unknown,
): { dias: number | null; origen: 'tipo' | 'defecto' | null; tipo: string; sinTipo: boolean } {
  const tipo = claveTipoServicio(tipoEfectivo(tipoManual, tipoFuente).tipo);
  const de = (t: string) => duraciones.find((d) => d.etapa === etapa && d.tipo === t)?.dias ?? null;
  const exacta = tipo && tipo !== TIPO_POR_DEFECTO ? de(tipo) : null;
  const dias = exacta ?? de(TIPO_POR_DEFECTO);
  return { dias, origen: exacta !== null ? 'tipo' : dias !== null ? 'defecto' : null, tipo, sinTipo: tipo === '' };
}

/** Un tipo de servicio que traen los tickets abiertos de la fuente de la agenda, y cuántos lo traen. */
export interface TipoAbierto {
  clave: string;
  etiqueta: string;
  tickets: number;
}

/**
 * Los tipos de servicio que traen unos tickets, uno por clave
 * (`claveTipoServicio`) y por orden alfabético: las columnas que la tabla de
 * duraciones debe ofrecer aunque el tipo no tenga fila en `tmc_plazos`. La
 * etiqueta es la grafía del ticket más antiguo. Sin tipo no cuenta, ni «*».
 */
export function tiposDeTickets(tickets: readonly { numero: number; tipoServicio: string | null }[]): TipoAbierto[] {
  const m = new Map<string, TipoAbierto>();
  for (const t of [...tickets].sort((a, b) => a.numero - b.numero)) {
    const clave = claveTipoServicio(t.tipoServicio);
    if (!clave || clave === TIPO_POR_DEFECTO) continue;
    const tipo = m.get(clave) ?? { clave, etiqueta: String(t.tipoServicio).replace(/\s+/g, ' ').trim(), tickets: 0 };
    tipo.tickets++;
    m.set(clave, tipo);
  }
  return [...m.values()].sort((a, b) => a.clave.localeCompare(b.clave));
}

// ── Contactos: a quién iría el aviso de cada equipo ─────────────────────────
//
// El contacto de un equipo sale del ticket más reciente de Zoho Desk con su
// serial; como quien abrió ese ticket puede no ser quien decide, se le puede
// poner uno a mano al CLIENTE, que gana para todos sus equipos.

/**
 * Dominios de correo propios. Un correo de Desk con uno de estos dominios (los
 * tickets viejos llevan como contacto a gente de la casa) NUNCA se usa como
 * destinatario de un cliente. Éste es el único sitio donde se define la lista.
 */
export const DOMINIOS_INTERNOS: readonly string[] = ['ambientalia.com.co'];

/** Largo máximo de un correo. */
export const EMAIL_MAX = 254;

/** Cuántos correos admite como mucho el contacto puesto a mano a un cliente. */
export const CONTACTO_MAX_EMAILS = 5;

/** Largo máximo del nombre de un cliente y del nombre de su contacto. */
export const CONTACTO_MAX_TEXTO = 200;

/** Un correo tal como se guarda y se compara: sin espacios alrededor y en minúsculas. Vacío si no es texto. */
export function normalizarEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

const EMAIL = /^[a-z0-9_%+'-]+(?:\.[a-z0-9_%+'-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** True si `v`, ya normalizado, tiene forma de correo (una sola dirección, sin nombre delante). */
export function esEmail(v: unknown): boolean {
  const e = normalizarEmail(v);
  return e.length > 0 && e.length <= EMAIL_MAX && EMAIL.test(e);
}

/** True si el correo es de un dominio propio (`DOMINIOS_INTERNOS`) o de un subdominio suyo. */
export function esEmailInterno(v: unknown): boolean {
  const e = normalizarEmail(v);
  const dominio = e.slice(e.lastIndexOf('@') + 1);
  if (!e.includes('@') || !dominio) return false;
  return DOMINIOS_INTERNOS.some((d) => dominio === d || dominio.endsWith(`.${d}`));
}

/**
 * Clave con la que casa un cliente: la misma normalización que la de los tipos
 * de servicio (sin mayúsculas, sin tildes y sin espacios repetidos ni
 * sobrantes). Con ella se guarda el contacto puesto a mano y se agrupan los
 * equipos de un cliente. Vacía si no hay nombre.
 */
export function claveCliente(cliente: unknown): string {
  return claveTipoServicio(cliente);
}

/** Nombre y apellido del contacto de un ticket, sin espacios de más. Puede quedar vacío. */
export function nombreContacto(nombre: unknown, apellido: unknown): string {
  return `${String(nombre ?? '')} ${String(apellido ?? '')}`.replace(/\s+/g, ' ').trim();
}

/** De dónde sale el contacto de un equipo: del ticket de Desk o puesto a mano a su cliente. */
export type OrigenContacto = 'desk' | 'manual';

/** El contacto de un equipo: a quién iría su aviso. */
export interface ContactoEquipo {
  /** Puede venir vacío. */
  nombre: string;
  /** En minúsculas. Con origen `manual` y varios correos, el primero (todos van en `ContactoCliente.emails`). */
  email: string;
  origen: OrigenContacto;
  /** El ticket de Desk del que sale; null si está puesto a mano. */
  ticket: number | null;
}

/** El contacto puesto a mano a un cliente (portal.tmc_contactos). */
export interface ContactoCliente {
  /** El cliente normalizado (`claveCliente`). */
  clave: string;
  /** El nombre del cliente tal como se escribió al guardarlo. */
  cliente: string;
  /** Nombre de la persona de contacto; vacío si no se puso. */
  nombre: string;
  /** Entre uno y `CONTACTO_MAX_EMAILS` correos, en minúsculas y sin repetir. */
  emails: string[];
  /** Los de `emails` que son de un dominio propio: a mano se admiten (para probar), pero se señalan. */
  internos: string[];
  actualizadoPor: string;
  actualizadoEn: string;
}

/** Lo que hace falta de un ticket de Desk para sacar de él un contacto. */
export interface TicketContacto {
  numero: number | null;
  email: unknown;
  nombre?: unknown;
  apellido?: unknown;
}

/**
 * El contacto que da Desk para un equipo: el del ticket de número más alto
 * (abierto o cerrado) cuyo correo no esté vacío, tenga forma de correo y no
 * sea interno. Si el más reciente no vale, se retrocede al anterior. Null si
 * ninguno vale.
 */
export function contactoDeTickets(tickets: readonly TicketContacto[]): ContactoEquipo | null {
  const orden = [...tickets].sort((a, b) => (b.numero ?? -Infinity) - (a.numero ?? -Infinity));
  for (const t of orden) {
    const email = normalizarEmail(t.email);
    if (!esEmail(email) || esEmailInterno(email)) continue;
    return { nombre: nombreContacto(t.nombre, t.apellido), email, origen: 'desk', ticket: t.numero };
  }
  return null;
}

/** El contacto que vale para un equipo: el puesto a mano a su cliente GANA al de Desk. */
export function contactoEfectivo(manual: ContactoCliente | null | undefined, desk: ContactoEquipo | null): ContactoEquipo | null {
  if (manual && manual.emails.length > 0) return { nombre: manual.nombre, email: manual.emails[0], origen: 'manual', ticket: null };
  return desk;
}

// ── Aviso automático a clientes: SIMULACIÓN ─────────────────────────────────
//
// La meta es avisar solos a 90, 60 y 30 días del vencimiento. Hoy esto es un
// ensayo: aquí sólo se CALCULA qué se enviaría y a quién, para enseñarlo en la
// pestaña «Avisos a clientes». Nada de este fichero envía nada, y no hay nada
// que lo llame para enviar.

/** Los tramos del aviso, en días antes del vencimiento, del primero al último. */
export const TRAMOS_AVISO = [90, 60, 30] as const;
export type TramoAviso = (typeof TRAMOS_AVISO)[number];

/** El tramo en el que está un equipo según su estado; null si no está en ninguno. */
export function tramoDeEstado(estado: EstadoCalibracion): TramoAviso | null {
  return estado === 'VENCE_90' ? 90 : estado === 'VENCE_60' ? 60 : estado === 'VENCE_30' ? 30 : null;
}

/** El día en que un equipo entra en un tramo: su vencimiento menos los días del tramo. */
export function entradaTramo(vence: string, tramo: TramoAviso): string {
  return sumarDias(vence, -tramo);
}

/** Lo que el plan del aviso necesita de un equipo (la `EquipoVista` del servidor lo cumple). */
export interface EquipoAviso {
  clave: string;
  serial: string;
  cliente: string;
  modelo: string;
  ultimaCalibracion: string | null;
  seguimiento: { enAmbientalia: boolean; avisoEnviado: string | null } | null;
  /** El ticket abierto en Desk, o null. Sólo importa si lo hay. */
  ticket: object | null;
  contacto: ContactoEquipo | null;
}

/**
 * El equipo ya está en manos de Ambientalia: marcado a mano en su ficha o con
 * un ticket de servicio abierto en Zoho Desk (aunque esté «sin confirmar»).
 */
export function enServicio(e: Pick<EquipoAviso, 'seguimiento' | 'ticket'>): boolean {
  return Boolean(e.seguimiento?.enAmbientalia) || e.ticket !== null;
}

/** Por qué a un equipo le tocaría (o no) el aviso automático hoy. */
export type MotivoAviso =
  | 'DEBIDO' // está en un tramo y aún no se le ha avisado en él: entraría en un correo
  | 'YA_AVISADO' // ya tiene un aviso desde que entró en su tramo
  | 'EN_SERVICIO' // está en un tramo, pero en Ambientalia o con ticket abierto
  | 'SIN_TRAMO' // al día o sin fecha: no toca nada
  | 'VENCIDA' // vencida en el último año: fuera de la regla automática
  | 'FUERA_CICLO'; // vencida hace más de un año: fuera de la regla automática

export interface AvisoEquipo<E extends EquipoAviso = EquipoAviso> {
  equipo: E;
  estado: EstadoCalibracion;
  vence: string | null;
  motivo: MotivoAviso;
  /** Su tramo de hoy; null fuera de los tres tramos. */
  tramo: TramoAviso | null;
  /** El día en que entró en ese tramo. */
  entradaTramo: string | null;
  /** Días hasta el vencimiento; negativo = vencida hace N días. */
  diasParaVencer: number | null;
}

/**
 * Decide, a fecha `hoy`, si a un equipo le tocaría el aviso automático.
 *  - Sólo en los tramos 90 / 60 / 30 (estados VENCE_90 / VENCE_60 / VENCE_30).
 *  - Nunca si está en servicio (`enServicio`).
 *  - Una vez por tramo: si su «aviso enviado» es del día en que entró en el
 *    tramo o posterior, ya está avisado; si es anterior (fue el del tramo de
 *    antes) o no hay, toca.
 *  - Vencida y fuera de ciclo no entran en la regla.
 */
export function evaluarAviso<E extends EquipoAviso>(equipo: E, hoy: string): AvisoEquipo<E> {
  const { estado, vence, vigenciaDias } = estadoCalibracion(equipo.ultimaCalibracion, hoy);
  const base = { equipo, estado, vence, diasParaVencer: vigenciaDias };
  const tramo = tramoDeEstado(estado);
  if (tramo === null || vence === null) {
    const motivo: MotivoAviso = estado === 'FUERA_CICLO' ? 'FUERA_CICLO' : estado === 'VENCIDA' ? 'VENCIDA' : 'SIN_TRAMO';
    return { ...base, motivo, tramo: null, entradaTramo: null };
  }
  const entrada = entradaTramo(vence, tramo);
  const aviso = equipo.seguimiento?.avisoEnviado ?? null;
  const motivo: MotivoAviso = enServicio(equipo) ? 'EN_SERVICIO' : aviso !== null && aviso >= entrada ? 'YA_AVISADO' : 'DEBIDO';
  return { ...base, motivo, tramo, entradaTramo: entrada };
}

/** Un destinatario de un correo simulado. */
export interface Destinatario {
  email: string;
  /** Puede venir vacío. */
  nombre: string;
  origen: OrigenContacto;
  /** True si es de un dominio propio: sólo puede pasar con uno puesto a mano. */
  interno: boolean;
  /** El ticket de Desk del que sale; null si está puesto a mano. */
  ticket: number | null;
}

/** Un correo que se enviaría: uno por cliente y tramo, con los equipos de ese cliente a los que toca. */
export interface CorreoSimulado<E extends EquipoAviso = EquipoAviso> {
  claveCliente: string;
  /** El nombre del cliente como lo trae su primer equipo. */
  cliente: string;
  tramo: TramoAviso;
  equipos: AvisoEquipo<E>[];
  /** Vacío = «sin destinatario». */
  destinatarios: Destinatario[];
  /** De dónde salen los destinatarios; null si no hay ninguno. */
  origen: OrigenContacto | null;
}

export interface PlanAvisos<E extends EquipoAviso = EquipoAviso> {
  hoy: string;
  /** Los correos que se enviarían: los que tienen al menos un destinatario. */
  correos: CorreoSimulado<E>[];
  /** Los grupos a los que tocaría avisar pero no tienen a quién. */
  sinDestinatario: CorreoSimulado<E>[];
  /** Informativos: por qué algo no está en la simulación. */
  yaAvisados: AvisoEquipo<E>[];
  enServicio: AvisoEquipo<E>[];
  /** Vencidas (hasta un año) que no están en servicio y sin aviso desde que vencieron. */
  vencidasSinAviso: AvisoEquipo<E>[];
  fueraCiclo: AvisoEquipo<E>[];
}

function destinatariosDe(equipos: readonly AvisoEquipo[], manual: ContactoCliente | undefined): Destinatario[] {
  if (manual && manual.emails.length > 0) {
    // El nombre es el de la persona de contacto: va con el primer correo; los demás son copias.
    return manual.emails.map((email, i) => ({ email, nombre: i === 0 ? manual.nombre : '', origen: 'manual', interno: esEmailInterno(email), ticket: null }));
  }
  const vistos = new Map<string, Destinatario>();
  for (const { equipo } of equipos) {
    const c = equipo.contacto;
    const email = normalizarEmail(c?.email);
    // Un interno que llegue de Desk no se usa nunca, aunque el servidor ya lo filtra.
    if (!c || !esEmail(email) || esEmailInterno(email) || vistos.has(email)) continue;
    vistos.set(email, { email, nombre: c.nombre, origen: 'desk', interno: false, ticket: c.ticket });
  }
  return [...vistos.values()];
}

/**
 * El plan del aviso automático a fecha `hoy`: qué correos se enviarían y qué
 * queda fuera y por qué. Un correo por cliente (por `claveCliente`) y tramo,
 * con los equipos de ese cliente a los que toca. Destinatarios: los correos
 * puestos a mano al cliente si los tiene (`manuales`) y, si no, los distintos
 * que den los contactos de Desk de esos equipos. Es sólo un cálculo.
 */
export function planAvisos<E extends EquipoAviso>(equipos: readonly E[], hoy: string, manuales: readonly ContactoCliente[] = []): PlanAvisos<E> {
  const manualDe = new Map(manuales.map((m) => [claveCliente(m.clave || m.cliente), m]));
  const plan: PlanAvisos<E> = { hoy, correos: [], sinDestinatario: [], yaAvisados: [], enServicio: [], vencidasSinAviso: [], fueraCiclo: [] };
  const grupos = new Map<string, CorreoSimulado<E>>();
  for (const e of equipos) {
    const a = evaluarAviso(e, hoy);
    if (a.motivo === 'YA_AVISADO') plan.yaAvisados.push(a);
    else if (a.motivo === 'EN_SERVICIO') plan.enServicio.push(a);
    else if (a.motivo === 'FUERA_CICLO') plan.fueraCiclo.push(a);
    else if (a.motivo === 'VENCIDA') {
      const aviso = e.seguimiento?.avisoEnviado ?? null;
      if (!enServicio(e) && !(aviso !== null && a.vence !== null && aviso >= a.vence)) plan.vencidasSinAviso.push(a);
    } else if (a.motivo === 'DEBIDO' && a.tramo !== null) {
      const clave = claveCliente(e.cliente);
      const id = `${a.tramo}|${clave}`;
      const g = grupos.get(id) ?? { claveCliente: clave, cliente: e.cliente.replace(/\s+/g, ' ').trim(), tramo: a.tramo, equipos: [], destinatarios: [], origen: null };
      g.equipos.push(a);
      grupos.set(id, g);
    }
  }
  const porDias = (a: AvisoEquipo, b: AvisoEquipo) => (a.diasParaVencer ?? 0) - (b.diasParaVencer ?? 0);
  for (const g of grupos.values()) {
    g.equipos.sort(porDias);
    g.destinatarios = destinatariosDe(g.equipos, manualDe.get(g.claveCliente));
    g.origen = g.destinatarios[0]?.origen ?? null;
    (g.destinatarios.length > 0 ? plan.correos : plan.sinDestinatario).push(g);
  }
  const porTramoYCliente = (a: CorreoSimulado, b: CorreoSimulado) => a.tramo - b.tramo || a.cliente.localeCompare(b.cliente, 'es');
  plan.correos.sort(porTramoYCliente);
  plan.sinDestinatario.sort(porTramoYCliente);
  for (const lista of [plan.yaAvisados, plan.enServicio, plan.vencidasSinAviso, plan.fueraCiclo]) lista.sort(porDias);
  return plan;
}
