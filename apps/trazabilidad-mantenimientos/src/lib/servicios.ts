/**
 * Geometría, filtros y textos de la pestaña «Servicios» (lista y calendario de
 * barras), y los textos de «Configuración».
 * Puro: sin React ni red. La fecha límite, los días hábiles, las pausas y el
 * estado de cada servicio NO se calculan aquí: llegan del servidor, que es
 * quien conoce los festivos y el historial de estados; aquí sólo se colocan en
 * columnas, se cuentan y se redactan.
 */
import {
  ESTADOS_PLAZO_TERMINADO,
  ETIQUETA_PLAZO,
  ETIQUETA_ROL,
  RETROCESO_MAX_DIAS,
  ROLES_ESTADO,
  claveTipoServicio,
  diasEntre,
  sumarDias,
  type EstadoDesk,
  type EstadoPlazo,
  type PlazoServicio,
  type RolEstado,
  type ServicioVista,
  type TipoServicioOpcion,
} from '../dominio';
import { MESES_CORTOS, fmtFecha } from './vistas';

/** Días en blanco que se dejan tras la última fecha límite (o tras hoy). */
export const MARGEN_EJE_DIAS = 5;
/** Días hacia atrás que enseña el eje cuando ningún servicio tiene barra. */
export const EJE_VACIO_DIAS = 7;

/**
 * Clases por estado del plazo. Literales completos: Tailwind sólo genera las
 * clases que lee tal cual. Los tres del trabajo terminado llevan la barra en un
 * tono más claro que los que siguen en marcha: verde si cumplió, rojo si no y
 * neutro si no se pudo medir.
 */
export const TONO_PLAZO: Record<EstadoPlazo, { badge: string; dot: string; text: string; barra: string }> = {
  VENCIDO: { badge: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500', text: 'text-red-600', barra: 'bg-red-500' },
  VENCE_HOY: { badge: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-400', text: 'text-amber-700', barra: 'bg-amber-400' },
  EN_PLAZO: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-700', barra: 'bg-emerald-500' },
  SIN_PLAZO: { badge: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400', text: 'text-slate-500', barra: 'bg-slate-300' },
  INCUMPLIDO: { badge: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-400', text: 'text-red-600', barra: 'bg-red-300' },
  CUMPLIDO: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-400', text: 'text-emerald-700', barra: 'bg-emerald-300' },
  TERMINADO: { badge: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400', text: 'text-slate-500', barra: 'bg-slate-400' },
};

const dHab = (n: number): string => `${n} día${n === 1 ? '' : 's'} hábil${n === 1 ? '' : 'es'}`;

/**
 * «quedan 2 d háb.» / «vence hoy» / «vencido hace 3 d háb.» / «sin plazo». Con
 * el reloj en pausa (standby) se dice delante: la cuenta está congelada. Con el
 * trabajo terminado, el veredicto: «cumplido» / «incumplido · 2 d háb.» /
 * «terminado» (no se pudo medir).
 */
export function textoPlazo(s: ServicioVista): string {
  const d = s.diasHabiles ?? 0;
  const pausa = s.enPausa ? 'en pausa · ' : '';
  switch (s.estadoPlazo) {
    case 'SIN_PLAZO':
      return 'sin plazo';
    case 'VENCE_HOY':
      return `${pausa}vence hoy`;
    case 'EN_PLAZO':
      return `${pausa}quedan ${d} d háb.`;
    case 'VENCIDO':
      // En fin de semana o festivo el límite ya pasó, pero aún no corre ningún día hábil de atraso.
      return `${pausa}${d < 0 ? `vencido hace ${-d} d háb.` : 'vencido'}`;
    case 'CUMPLIDO':
      return 'cumplido';
    case 'INCUMPLIDO':
      // Llegó en fin de semana o festivo tras el límite: tarde, pero sin días hábiles de atraso.
      return d < 0 ? `incumplido · ${-d} d háb.` : 'incumplido';
    case 'TERMINADO':
      return 'terminado';
  }
}

const RANGO: Record<EstadoPlazo, number> = { VENCIDO: 0, VENCE_HOY: 1, EN_PLAZO: 2, SIN_PLAZO: 3, INCUMPLIDO: 4, CUMPLIDO: 5, TERMINADO: 6 };
/** Un terminado sin plazo no tiene veredicto que ordenar: va el último. */
const rango = (s: ServicioVista): number => (s.estadoPlazo === 'SIN_PLAZO' && s.rolEstado === 'terminado' ? 7 : RANGO[s.estadoPlazo]);

/**
 * Más atraso primero, después lo que vence antes y los «sin plazo», del ticket
 * más nuevo al más viejo. Los que ya tienen el trabajo terminado van detrás de
 * todos los que siguen en marcha: incumplidos (más atraso primero), cumplidos
 * y sin medir.
 */
export const porUrgenciaPlazo = (a: ServicioVista, b: ServicioVista): number =>
  rango(a) - rango(b) || (a.diasHabiles ?? 0) - (b.diasHabiles ?? 0) || b.numero - a.numero;

/** Cuántos servicios hay en cada estado del plazo (todos los estados, también los que no tienen ninguno). */
export function contarPlazos(servicios: readonly ServicioVista[]): Record<EstadoPlazo, number> {
  const c: Record<EstadoPlazo, number> = { VENCIDO: 0, VENCE_HOY: 0, EN_PLAZO: 0, SIN_PLAZO: 0, INCUMPLIDO: 0, CUMPLIDO: 0, TERMINADO: 0 };
  for (const s of servicios) c[s.estadoPlazo]++;
  return c;
}

/** Un filtro por estado del plazo. Casi todos cubren un estado; «Terminado» cubre los tres del trabajo terminado. */
export interface GrupoPlazo {
  clave: string;
  etiqueta: string;
  estados: readonly EstadoPlazo[];
  /** Clase del punto de color. */
  dot: string;
}

const grupoDe = (e: EstadoPlazo): GrupoPlazo => ({ clave: e, etiqueta: ETIQUETA_PLAZO[e], estados: [e], dot: TONO_PLAZO[e].dot });

/**
 * Los filtros del plazo, en orden. Los tres veredictos del trabajo terminado
 * van en uno solo para no alargar la fila; su desglose va en el `title`
 * (`tituloGrupo`). Cada estado del plazo está en un grupo, y sólo en uno.
 */
export const GRUPOS_PLAZO: readonly GrupoPlazo[] = [
  grupoDe('VENCIDO'),
  grupoDe('VENCE_HOY'),
  grupoDe('EN_PLAZO'),
  grupoDe('SIN_PLAZO'),
  { clave: 'TERMINADO', etiqueta: 'Terminado', estados: ESTADOS_PLAZO_TERMINADO, dot: 'bg-slate-400' },
];

/** Cuántos servicios caen en el filtro. */
export const contarGrupo = (g: GrupoPlazo, cnt: Record<EstadoPlazo, number>): number => g.estados.reduce((n, e) => n + cnt[e], 0);

/** True si el filtro está puesto: todos sus estados están entre los elegidos. */
export const grupoElegido = (g: GrupoPlazo, elegidos: readonly EstadoPlazo[]): boolean => g.estados.every((e) => elegidos.includes(e));

/** Pone o quita el filtro entero: nunca deja un grupo a medias. */
export function alternarGrupo(g: GrupoPlazo, elegidos: readonly EstadoPlazo[]): EstadoPlazo[] {
  if (grupoElegido(g, elegidos)) return elegidos.filter((e) => !g.estados.includes(e));
  return [...elegidos, ...g.estados.filter((e) => !elegidos.includes(e))];
}

/** El `title` de un filtro que cubre varios estados: su desglose. Undefined en los de un solo estado. */
export function tituloGrupo(g: GrupoPlazo, cnt: Record<EstadoPlazo, number>): string | undefined {
  if (g.estados.length < 2) return undefined;
  const n = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`;
  return `Trabajo terminado (reloj parado): ${n(cnt.CUMPLIDO, 'cumplido', 'cumplidos')} · ${n(cnt.INCUMPLIDO, 'incumplido', 'incumplidos')} · ${cnt.TERMINADO} sin medir`;
}

export interface ResumenServicios {
  total: number;
  conPlazo: number;
  /** Tickets sin tipo de servicio (ni puesto a mano ni de Desk): no pueden tener plazo. */
  sinTipo: number;
  sinConfirmar: number;
  /** Tipos que sí vienen pero no tienen plazo en Configuración. */
  tiposSinPlazo: string[];
}

export function resumenServicios(servicios: readonly ServicioVista[]): ResumenServicios {
  const tipos = new Map<string, string>();
  let conPlazo = 0;
  let sinTipo = 0;
  let sinConfirmar = 0;
  for (const s of servicios) {
    const clave = claveTipoServicio(s.tipoServicio);
    if (s.fechaLimite) conPlazo++;
    if (!clave) sinTipo++;
    else if (s.plazoDias === null && !tipos.has(clave)) tipos.set(clave, s.tipoServicio.trim());
    if (s.sinConfirmar) sinConfirmar++;
  }
  return {
    total: servicios.length,
    conPlazo,
    sinTipo,
    sinConfirmar,
    tiposSinPlazo: [...tipos.values()].sort((a, b) => a.localeCompare(b, 'es')),
  };
}

/**
 * El aviso azul de arriba: Desk no manda el tipo de servicio, y se elige a
 * mano. Null cuando ya no queda ningún servicio sin tipo (el aviso se va solo).
 */
export function avisoSinTipo(res: Pick<ResumenServicios, 'total' | 'sinTipo'>): { titulo: string; texto: string } | null {
  if (res.total === 0 || res.sinTipo === 0) return null;
  const todos = res.sinTipo === res.total;
  const uno = res.sinTipo === 1;
  return {
    titulo: todos ? 'Zoho Desk todavía no envía el tipo de servicio' : `${res.sinTipo} de ${res.total} servicios ${uno ? 'sigue' : 'siguen'} sin tipo de servicio`,
    texto: `${
      todos ? 'Sin tipo no se puede calcular la fecha límite, y los servicios salen «sin plazo».' : 'Zoho Desk no lo envía y, mientras no lo tengan, salen «sin plazo».'
    } Elígelo a mano en la columna «Tipo de servicio» de la lista: el plazo y la barra del calendario aparecen al momento.`,
  };
}

/** Qué quiere decir «standby» (el `title` del filtro): el reloj del plazo está en pausa. */
export const TITULO_STANDBY =
  'Standby: reloj en pausa, a la espera del cliente o de un servicio externo. Los días hábiles que el ticket pasa así no cuentan para el plazo.';

/**
 * El `title` de la etiqueta «standby» de un servicio: cuántos días hábiles
 * lleva en pausa y desde cuándo mide el portal (lo anterior no se puede saber
 * y cuenta como activo).
 */
export function tituloStandby(s: Pick<ServicioVista, 'diasPausados' | 'medidoDesde'>): string {
  const dias = s.diasPausados > 0 ? `${dHab(s.diasPausados)} en pausa hasta ahora` : 'Ningún día hábil en pausa hasta ahora';
  return `Standby: reloj en pausa. ${dias}${s.medidoDesde ? `, medido desde el ${fmtFecha(s.medidoDesde)}` : ''}.`;
}

/**
 * El `title` de la etiqueta «terminado»: cuándo se paró el reloj y qué se sabe
 * del plazo. Si el portal vio el ticket por primera vez ya terminado, no hay
 * forma de saber desde cuándo lo estaba.
 */
export function tituloTerminado(s: Pick<ServicioVista, 'terminadoEl' | 'estadoPlazo'>): string {
  const el = s.terminadoEl ? fmtFecha(s.terminadoEl) : '';
  if (s.estadoPlazo === 'TERMINADO') {
    return `Trabajo terminado: el reloj está parado. El portal lo vio por primera vez ya terminado${el ? ` (el ${el})` : ''}, así que no se puede medir si cumplió.`;
  }
  const veredicto = s.estadoPlazo === 'CUMPLIDO' ? ' Llegó dentro del plazo.' : s.estadoPlazo === 'INCUMPLIDO' ? ' Llegó después de la fecha límite.' : '';
  return `Trabajo terminado${el ? ` el ${el}` : ''}: el reloj está parado.${veredicto}`;
}

/** Cuántos servicios están ahora en un estado de Desk con rol standby (reloj en pausa). */
export const contarStandby = (servicios: readonly ServicioVista[]): number => servicios.filter((s) => s.enPausa).length;

export interface FiltroServicios {
  /** Estados del plazo elegidos; vacío = todos. */
  estados: readonly EstadoPlazo[];
  /** True = sólo los que están en standby (reloj en pausa). */
  standby: boolean;
  /** Lo escrito en el buscador: ticket, cliente o serial. */
  texto: string;
}

/**
 * Los servicios que pasan los filtros de la pestaña, en su mismo orden. Los
 * filtros se suman: uno de los estados del plazo elegidos Y, si se pide, en
 * standby Y que case con el buscador.
 */
export function filtrarServicios(servicios: readonly ServicioVista[], f: FiltroServicios): ServicioVista[] {
  const q = f.texto.trim().toLowerCase();
  return servicios.filter(
    (s) =>
      (f.estados.length === 0 || f.estados.includes(s.estadoPlazo)) &&
      (!f.standby || s.enPausa) &&
      (!q || String(s.numero).includes(q) || s.cliente.toLowerCase().includes(q) || s.serial.toLowerCase().includes(q)),
  );
}

const TIPO_DESK: Record<string, string> = { Open: 'Abierto', 'On Hold': 'En espera', Closed: 'Cerrado' };

/**
 * El tipo de estado de Desk (`status_type`) en español. Uno que no se conozca
 * se enseña tal cual; sin tipo (ningún ticket tiene ya ese estado) queda vacío.
 */
export function etiquetaTipoDesk(tipo: string | null): string {
  if (!tipo) return '';
  return Object.prototype.hasOwnProperty.call(TIPO_DESK, tipo) ? TIPO_DESK[tipo] : tipo;
}

/** Lo que cada rol le hace al reloj del plazo, en una frase. */
const AYUDA_ROL: Record<RolEstado, string> = {
  cuenta: 'El tiempo en este estado cuenta para el plazo.',
  standby: 'Reloj en pausa: a la espera del cliente o de un servicio externo.',
  terminado: 'Reloj parado: el trabajo técnico está hecho.',
};

export interface OpcionRol {
  valor: RolEstado;
  texto: string;
  /** Qué le hace al reloj. */
  ayuda: string;
}

/** Las tres opciones del desplegable de rol de un estado de Desk, en orden. Son excluyentes. */
export const OPCIONES_ROL: readonly OpcionRol[] = ROLES_ESTADO.map((valor) => ({ valor, texto: ETIQUETA_ROL[valor], ayuda: AYUDA_ROL[valor] }));

/** Qué rol tiene un estado de Desk, quién lo eligió y cuándo, y qué le hace al reloj: el `title` de su desplegable. */
export function notaEstadoDesk(e: EstadoDesk): string {
  const quien = e.actualizadoPor ? `«${ETIQUETA_ROL[e.rol]}», elegido por ${e.actualizadoPor} el ${fmtFecha(e.actualizadoEn)}.` : `Nadie lo ha cambiado: ${ETIQUETA_ROL[e.rol].toLowerCase()}.`;
  return `${quien} ${AYUDA_ROL[e.rol]}`;
}

/** El aviso que sale al guardar el rol de un estado: «Por Facturar: trabajo terminado (reloj parado)». */
export function avisoRol(etiqueta: string, rol: RolEstado): string {
  const efecto = rol === 'standby' ? ' (reloj en pausa)' : rol === 'terminado' ? ' (reloj parado)' : '';
  return `${etiqueta}: ${ETIQUETA_ROL[rol].toLowerCase()}${efecto}`;
}

export interface OpcionTipo {
  /** La clave del tipo; vacía = sin tipo puesto a mano (vale lo que diga Desk). */
  valor: string;
  texto: string;
}

/** «Diagnóstico · 3 días háb.». En un tipo compuesto los días ya vienen sumados del servidor. */
const textoOpcion = (etiqueta: string, dias: number | null): string =>
  `${etiqueta} · ${dias === null ? 'sin plazo' : `${dias} día${dias === 1 ? '' : 's'} háb.`}`;

/**
 * El desplegable del tipo de servicio de un ticket. La primera opción (valor
 * vacío) es «no hay tipo puesto a mano»: «Sin tipo» si Desk no trae ninguno, o
 * «Según Desk: …» si lo trae. Después, los tipos de Configuración en su orden.
 * `valor` es lo elegido ahora: la clave del puesto a mano, o vacío.
 */
export function selectorTipo(s: ServicioVista, tipos: readonly TipoServicioOpcion[]): { valor: string; opciones: OpcionTipo[] } {
  const valor = s.tipoManual?.clave ?? '';
  const opciones: OpcionTipo[] = [
    { valor: '', texto: s.tipoDesk ? `Según Desk: ${s.tipoDesk}` : 'Sin tipo' },
    ...tipos.map((t) => ({ valor: t.clave, texto: textoOpcion(t.etiqueta, t.dias) })),
  ];
  // Un tipo puesto a mano cuya fila ya no está en Configuración: se enseña igual, para que el desplegable diga la verdad.
  if (valor && !tipos.some((t) => t.clave === valor)) opciones.push({ valor, texto: textoOpcion(s.tipoServicio, s.plazoDias) });
  return { valor, opciones };
}

/** De dónde sale el tipo de un servicio, para el `title` de su desplegable. */
export function notaTipo(s: ServicioVista): string {
  if (s.tipoManual) {
    const desk = s.tipoDesk && claveTipoServicio(s.tipoDesk) !== s.tipoManual.clave ? ` Zoho Desk dice: ${s.tipoDesk}.` : '';
    return `Puesto a mano por ${s.tipoManual.por} el ${fmtFecha(s.tipoManual.en)}.${desk}`;
  }
  return s.tipoDesk ? 'Tipo de servicio según Zoho Desk.' : 'Zoho Desk no envía el tipo de servicio de este ticket: elígelo aquí.';
}

/** Eje de tiempo del calendario: una columna por día, de `inicio` a `fin` (ambos incluidos). */
export interface Eje {
  inicio: string;
  fin: string;
  dias: number;
}

const tieneBarra = (s: ServicioVista): s is ServicioVista & { ingreso: string; fechaLimite: string } => Boolean(s.ingreso && s.fechaLimite);

/**
 * El eje que hace falta para pintar los servicios con plazo: desde un día antes
 * del primer ingreso —sin retroceder más de RETROCESO_MAX_DIAS desde hoy, para
 * que un ticket antiguo no lo aplaste todo— hasta unos días después de la
 * última fecha límite, o de hoy si todo está vencido.
 */
export function ejeServicios(servicios: readonly ServicioVista[], hoy: string): Eje {
  const conBarra = servicios.filter(tieneBarra);
  let inicio = sumarDias(hoy, -EJE_VACIO_DIAS);
  let ultimo = hoy;
  if (conBarra.length) {
    const primero = conBarra.reduce((min, s) => (s.ingreso < min ? s.ingreso : min), hoy);
    const tope = sumarDias(hoy, -RETROCESO_MAX_DIAS);
    inicio = sumarDias(primero, -1);
    if (inicio < tope) inicio = tope;
    ultimo = conBarra.reduce((max, s) => (s.fechaLimite > max ? s.fechaLimite : max), hoy);
  }
  const fin = sumarDias(ultimo, MARGEN_EJE_DIAS);
  return { inicio, fin, dias: diasEntre(inicio, fin) + 1 };
}

/** Columna (0 = `eje.inicio`) de una fecha; puede caer fuera del eje. */
export const columna = (eje: Eje, fecha: string): number => diasEntre(eje.inicio, fecha);

/** Tramo de columnas, ambas incluidas. */
export interface Tramo {
  desde: number;
  hasta: number;
}

export interface Barra {
  /**
   * Del ingreso a la fecha límite (ya corrida por las pausas); null si cae
   * entera antes del eje. Con el trabajo terminado acaba el día en que se
   * terminó, sea antes o después del límite.
   */
  plazo: Tramo | null;
  /** Del día siguiente a la fecha límite hasta hoy, si está vencido. Nunca con el trabajo terminado: el reloj está parado. */
  atraso: Tramo | null;
  /** True si el ingreso es anterior al eje: la barra empieza cortada por la izquierda. */
  recortada: boolean;
  /** La columna del día en que se terminó el trabajo (la marca de fin); null si sigue en marcha o si cae fuera del eje. */
  terminado: number | null;
}

/** Recorta un tramo al eje; null si queda entero fuera. */
function recortar(eje: Eje, desde: number, hasta: number): Tramo | null {
  const t = { desde: Math.max(desde, 0), hasta: Math.min(hasta, eje.dias - 1) };
  return t.desde <= t.hasta ? t : null;
}

/** La barra de un servicio sobre el eje, o null si no tiene plazo. */
export function barraServicio(s: ServicioVista, eje: Eje, hoy: string): Barra | null {
  if (!tieneBarra(s)) return null;
  const recortada = s.ingreso < eje.inicio;
  if (s.terminadoEl) {
    const fin = columna(eje, s.terminadoEl);
    return { plazo: recortar(eje, columna(eje, s.ingreso), fin), atraso: null, recortada, terminado: fin >= 0 && fin < eje.dias ? fin : null };
  }
  const limite = columna(eje, s.fechaLimite);
  return {
    plazo: recortar(eje, columna(eje, s.ingreso), limite),
    atraso: s.fechaLimite < hoy ? recortar(eje, limite + 1, columna(eje, hoy)) : null,
    recortada,
    terminado: null,
  };
}

/**
 * Los días en pausa de un servicio, en columnas, para pintarlos sobre su
 * barra: cada rango se recorta al eje y a lo que ocupa la barra (plazo y
 * atraso). Los rangos llegan del servidor; aquí no se decide qué es pausa.
 * Vacío si el servicio no tiene barra.
 */
export function pausasBarra(s: ServicioVista, eje: Eje, hoy: string): Tramo[] {
  const b = barraServicio(s, eje, hoy);
  const primero = b?.plazo ?? b?.atraso;
  const ultimo = b?.atraso ?? b?.plazo;
  if (!primero || !ultimo) return [];
  const out: Tramo[] = [];
  for (const p of s.pausas) {
    const t = { desde: Math.max(columna(eje, p.desde), primero.desde), hasta: Math.min(columna(eje, p.hasta), ultimo.hasta) };
    if (t.desde <= t.hasta) out.push(t);
  }
  return out;
}

/** Qué entradas de la leyenda del calendario hacen falta: sólo las de lo que hay pintado. */
export function leyendaServicios(servicios: readonly ServicioVista[]): { pausas: boolean; dosTramos: boolean; terminados: EstadoPlazo[] } {
  const conBarra = servicios.filter(tieneBarra);
  return {
    pausas: conBarra.some((s) => s.pausas.length > 0),
    dosTramos: conBarra.some((s) => s.tramos !== null && s.tramos.length >= 2),
    terminados: ESTADOS_PLAZO_TERMINADO.filter((e) => conBarra.some((s) => s.terminadoEl !== null && s.estadoPlazo === e)),
  };
}

/** Un tramo de la barra de un servicio de tipo compuesto («Diagnóstico + Calibración»). */
export interface SegmentoBarra {
  /** La parte que ocupa el tramo («Diagnóstico»). */
  etiqueta: string;
  /** Sus días hábiles. */
  dias: number;
  /** Último día del tramo (AAAA-MM-DD), tal como lo manda el servidor. */
  hasta: string;
  /** Las columnas que ocupa; null si cae entero fuera del eje. */
  tramo: Tramo | null;
}

/**
 * La barra del plazo partida en los tramos de un tipo compuesto: el primero va
 * del ingreso a su último día y cada uno de los siguientes empieza al día
 * siguiente de donde acabó el anterior, hasta la fecha límite. Juntos ocupan
 * exactamente `barraServicio(…).plazo`; el atraso, si lo hay, sigue detrás y no
 * es cosa de aquí. Las fechas de fin llegan del servidor (él cuenta los días
 * hábiles): aquí sólo se pasan a columnas y se recortan al eje. Con el trabajo
 * terminado la barra acaba el día en que se terminó, y los tramos con ella: el
 * que no llegó a empezar queda sin columnas.
 * Null si el servicio no tiene barra o su tipo no es compuesto.
 */
export function segmentosBarra(s: ServicioVista, eje: Eje): SegmentoBarra[] | null {
  if (!tieneBarra(s) || !s.tramos || s.tramos.length < 2) return null;
  const tope = s.terminadoEl ? columna(eje, s.terminadoEl) : Number.POSITIVE_INFINITY;
  let desde = columna(eje, s.ingreso);
  return s.tramos.map((t) => {
    const hasta = columna(eje, t.hasta);
    const tramo = recortar(eje, desde, Math.min(hasta, tope));
    desde = hasta + 1;
    return { etiqueta: t.etiqueta, dias: t.dias, hasta: t.hasta, tramo };
  });
}

const diasHab = (dias: number): string => `${dias} día${dias === 1 ? '' : 's'} háb.`;

/** «Diagnóstico: hasta el 06/10/2026 (3 días háb.)»: el `title` de un tramo de la barra. */
export const tituloSegmento = (seg: Pick<SegmentoBarra, 'etiqueta' | 'dias' | 'hasta'>): string =>
  `${seg.etiqueta}: hasta el ${fmtFecha(seg.hasta)} (${diasHab(seg.dias)})`;

/**
 * «Diagnóstico hasta el 06/10/2026 · Calibración hasta el 13/10/2026»: las
 * fechas de cada tramo de un tipo compuesto, para el `title` de la fecha
 * límite en la lista. Null si el servicio no los tiene.
 */
export function textoTramos(s: ServicioVista): string | null {
  if (!s.tramos || s.tramos.length < 2) return null;
  return s.tramos.map((t) => `${t.etiqueta} hasta el ${fmtFecha(t.hasta)}`).join(' · ');
}

/**
 * El `title` de la fecha límite en la lista, o null si no hay nada que añadir:
 * en un tipo compuesto, hasta cuándo va cada tramo; y si hay días en pausa,
 * cuál sería la fecha sin ellos y cuántos son (la que se enseña ya está corrida).
 */
export function tituloFechaLimite(s: ServicioVista): string | null {
  const partes: string[] = [];
  const tramos = textoTramos(s);
  if (tramos) partes.push(tramos);
  if (s.fechaLimite && s.diasPausados > 0) {
    partes.push(
      s.fechaLimiteBase && s.fechaLimiteBase !== s.fechaLimite
        ? `Sin pausas sería el ${fmtFecha(s.fechaLimiteBase)}: ${dHab(s.diasPausados)} en pausa`
        : `${dHab(s.diasPausados)} en pausa después de la fecha límite: no la mueven`,
    );
  }
  return partes.length > 0 ? partes.join(' · ') : null;
}

/** «A», «A y B», «A, B y C». */
const enumerar = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

/**
 * Lo que enseña «Configuración» en la fila de un tipo compuesto, que no se
 * edita: sus días calculados y de qué suma salen; o «sin plazo» y a qué parte
 * le falta. Null si el tipo es simple (tiene su casilla de siempre).
 */
export function notaDerivado(p: PlazoServicio): { valor: string; nota: string; falta: boolean } | null {
  if (!p.derivadoDe) return null;
  const sinPlazo = p.derivadoDe.filter((x) => x.dias === null);
  if (p.dias === null || sinPlazo.length > 0) {
    const falta = sinPlazo.length > 0 ? `: falta el plazo de ${enumerar(sinPlazo.map((x) => x.etiqueta))}` : '';
    return { valor: 'sin plazo', nota: `suma de ${enumerar(p.derivadoDe.map((x) => x.etiqueta))}${falta}`, falta: true };
  }
  return {
    valor: `${p.dias} día${p.dias === 1 ? '' : 's'} hábil${p.dias === 1 ? '' : 'es'}`,
    nota: `suma de ${enumerar(p.derivadoDe.map((x) => `${x.etiqueta} (${x.dias})`))}`,
    falta: false,
  };
}

export interface DiaEje {
  fecha: string;
  /** Día del mes. */
  dia: number;
  /** False en sábado, domingo o festivo. */
  habil: boolean;
}

/** Las columnas del eje, con los días no hábiles marcados (los festivos los manda el servidor). */
export function diasDelEje(eje: Eje, festivos: readonly string[]): DiaEje[] {
  const f = new Set(festivos);
  return Array.from({ length: eje.dias }, (_, i) => {
    const fecha = sumarDias(eje.inicio, i);
    const dow = new Date(`${fecha}T00:00:00Z`).getUTCDay();
    return { fecha, dia: Number(fecha.slice(8)), habil: dow !== 0 && dow !== 6 && !f.has(fecha) };
  });
}

/** Los meses que cruza el eje, cada uno con su tramo de columnas (cabecera del calendario). */
export function mesesDelEje(eje: Eje): (Tramo & { etiqueta: string })[] {
  const out: (Tramo & { etiqueta: string })[] = [];
  for (let i = 0; i < eje.dias; i++) {
    const [y, m] = sumarDias(eje.inicio, i).split('-').map(Number);
    const etiqueta = `${MESES_CORTOS[m - 1]} ${y}`;
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.etiqueta === etiqueta) ultimo.hasta = i;
    else out.push({ etiqueta, desde: i, hasta: i });
  }
  return out;
}
