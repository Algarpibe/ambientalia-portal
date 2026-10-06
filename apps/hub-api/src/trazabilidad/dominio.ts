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
