/**
 * Calibraciones desde Desk 2.0 (lote 9c): lo que calculan la tarjeta
 * «Calibraciones · Desk 2.0» de Configuración y el bloque «Calibraciones» de la
 * ficha de un equipo a partir de lo que da el servidor. Puro, sin reloj ni red:
 * la regla en sí es de hub-api (`calibraciones.ts`).
 */
import { TIPOS_DETALLE, type CalibracionHistorial, type CalibracionHoja, type DetalleCalibracion, type EstadoFilaCalibracion, type PasadaCalibraciones, type RecuentosCalibraciones, type TipoDetalle } from '../dominio';
import type { LineaPlan } from './maestro';
import { fmtFecha, fmtFechaHora } from './vistas';

const cambiadas = (r: RecuentosCalibraciones): number => r.cambiadas + r.reenlazadas;

/** ¿Traer escribiría algo? Si no, sólo dejaría constancia de la pasada. */
export const hayQueTraer = (r: RecuentosCalibraciones): boolean => r.nuevas + cambiadas(r) + r.vaciadas + r.partida > 0;

/** El plan, en el orden en que se lee. Sólo rótulos y números: nada de aquí lleva un cliente ni un serial. */
export function lineasPlan(r: RecuentosCalibraciones): LineaPlan[] {
  const dato = (texto: string, valor: number | string): LineaPlan => ({ texto, valor: String(valor), cambia: false, aviso: false });
  const escribe = (texto: string, valor: number): LineaPlan => ({ texto, valor: String(valor), cambia: valor > 0, aviso: false });
  const mirar = (texto: string, valor: number): LineaPlan => ({ texto, valor: String(valor), cambia: false, aviso: valor > 0 });
  const siHay = (linea: LineaPlan, n: number): LineaPlan[] => (n > 0 ? [linea] : []);
  return [
    dato('Tickets en Desk 2.0', r.tickets),
    dato('· con el detalle de Zoho (los que Desk 2.0 ha releído)', r.conCf),
    dato('Tickets con «Fecha de Calibración»', `${r.conCampo} (${r.porNombre} por nombre interno · ${r.porEtiqueta} sólo por etiqueta)`),
    ...siHay(dato('· de tickets que gestiona Desk 2.0 (ya no reciben cambios de Zoho)', r.gestionadosPorApp), r.gestionadosPorApp),
    escribe('Calibraciones nuevas', r.nuevas),
    dato('Sin cambios', r.sinCambios),
    escribe('Cambiadas en Zoho (se anula la fila y entra la fecha nueva)', cambiadas(r)),
    mirar('Anuladas: el campo se vació en Zoho', r.vaciadas),
    mirar('En revisión: fecha futura o imposible, o serial ambiguo (no cuentan)', r.enRevision),
    mirar('Sin equipo: el ticket no trae serial ni equipo (no entran)', r.sinEquipo),
    ...siHay(mirar('Con un valor que no es una fecha (no entran)', r.ilegibles), r.ilegibles),
    dato('De otras marcas (se guardan sin equipo del inventario)', r.otrasMarcas),
    ...siHay(dato('Anuladas a mano que no se vuelven a traer', r.noResucitan), r.noResucitan),
    ...siHay(dato('Anteriores a la fecha que ya tiene su equipo (quedan como historial)', r.historial), r.historial),
    escribe('Punto de partida: equipos que reciben su fecha de la F-ST-022', r.partida),
    ...siHay(dato('· sin fecha en la hoja congelada (vale la del inventario)', r.partidaDeInventario), r.partida),
    ...siHay(mirar('· con una fecha en la hoja y otra en el inventario (manda la hoja)', r.partidaDistintas), r.partida),
    escribe('Equipos a los que les cambiaría la última calibración', r.equiposCambian),
    escribe('· saldrían de los avisos', r.salenDeAvisos),
    mirar('· entrarían en los avisos', r.entranEnAvisos),
  ];
}

const cuantas = (n: number, una: string): string => `${n} ${una}${n === 1 ? '' : 's'}`;

/** La última pasada: quién, cuándo (hora de Colombia) y qué trajo. */
export function textoUltima(u: PasadaCalibraciones): string {
  const r = u.recuentos;
  return `${u.por} · ${fmtFechaHora(u.en)} · ${hayQueTraer(r) ? `${cuantas(r.nuevas + r.partida, 'nueva')}, ${cuantas(cambiadas(r), 'cambiada')} y ${cuantas(r.vaciadas, 'anulada')}` : 'sin cambios'}`;
}

/** Cada tipo del detalle: su título, si va abierto (lo que hay que mirar antes de traer) y una nota. El orden es el de `TIPOS_DETALLE`. */
const BLOQUES: Record<TipoDetalle, { titulo: string; abierto: boolean; nota?: string }> = {
  revision: { titulo: 'En revisión: no cuentan hasta que alguien las mire', abierto: true, nota: 'Fecha posterior a hoy o imposible, o un serial que está en más de un equipo. Se corrige en Zoho (o el equipo, en Desk 2.0) y se vuelven a traer.' },
  cambiada: { titulo: 'Cambiadas en Zoho: se anula la fila y entra la fecha nueva', abierto: true },
  vaciada: { titulo: 'Anuladas: el campo se vació en Zoho', abierto: true, nota: 'El ticket ya no trae la fecha. Si son muchas a la vez, no las traigas: puede que el campo haya cambiado de nombre.' },
  sin_equipo: { titulo: 'Sin equipo: no entran', abierto: true, nota: 'El ticket no trae serial ni equipo: ponle el equipo en Desk 2.0.' },
  distinta: { titulo: 'Punto de partida con dos fechas: manda la hoja congelada', abierto: true, nota: 'La hoja congelada y el inventario del portal dan fechas distintas para el equipo; «antes» es la del inventario, la que se ve hoy.' },
  ilegible: { titulo: 'Con un valor que no es una fecha: no entran', abierto: true },
  no_resucita: { titulo: 'Anuladas a mano: no se vuelven a traer', abierto: false },
  nueva: { titulo: 'Calibraciones nuevas', abierto: false },
  otra_marca: { titulo: 'De otras marcas: se guardan sin equipo del inventario', abierto: false, nota: 'El serial no es de un GRIMM EDM 180 del inventario. No cambian nada de lo que hoy se ve.' },
  partida: { titulo: 'Punto de partida, de la F-ST-022', abierto: false },
};

export interface BloqueDetalle { titulo: string; nota?: string; abierto: boolean; items: [string, string][] }

const item = (d: DetalleCalibracion): [string, string] => [
  d.ticket !== null ? `ticket ${d.ticket} · ${d.serial || '(sin serial)'}` : d.serial,
  d.tipo === 'vaciada' ? `se anula la del ${fmtFecha(d.antes)}` : `${fmtFecha(d.fecha)}${d.antes ? ` (antes, ${fmtFecha(d.antes)})` : ''}${d.nota ? ` · ${d.nota}` : ''}`,
];

/** El detalle repartido como se enseña al confirmar: un bloque por tipo, lo que hay que mirar primero arriba; los vacíos no salen. */
export function bloquesDetalle(detalle: readonly DetalleCalibracion[]): BloqueDetalle[] {
  return TIPOS_DETALLE.map((tipo) => ({ tipo, items: detalle.filter((d) => d.tipo === tipo).map(item) }))
    .filter((b) => b.items.length > 0)
    .map(({ tipo, items }) => ({ titulo: `${BLOQUES[tipo].titulo} (${items.length})`, nota: BLOQUES[tipo].nota, abierto: BLOQUES[tipo].abierto, items }));
}

export const ETIQUETA_ESTADO_FILA: Record<EstadoFilaCalibracion, string> = { vigente: 'Vigente', anulada: 'Anulada', en_revision: 'En revisión' };

// ── Corregir una fecha a mano (lote 9d-2b): lo que la lista de calibraciones dice y ofrece de cada una ──

/** Una manual se distingue a la vista: quién la registró y cuándo. Las demás, nada. */
export const firmaManual = (c: CalibracionHoja): string => (c.origen === 'manual' && c.por ? `por ${c.por} el ${fmtFecha(c.en)}` : '');

/** El detalle de una calibración (su `title`): quién, cuándo y por qué; y lo mismo de su anulación. La partida de una fila de la hoja (id negativo) no la firma nadie. */
export function detalleCalibracion(c: CalibracionHoja): string {
  if (!c.por) return 'La fecha que traía la hoja F-ST-022 congelada.';
  return `Registrada por ${c.por} el ${fmtFechaHora(c.en)}${c.motivo ? ` · ${c.motivo}` : ''}${c.anuladaPor ? ` · Anulada por ${c.anuladaPor} el ${fmtFechaHora(c.anuladaEn)}${c.anuladaMotivo ? `: ${c.anuladaMotivo}` : ''}` : ''}`;
}

/** Los tickets cuya fecha se puede corregir con una manual: los de Desk 2.0 sin anular (también en revisión), el más reciente primero. */
export const ticketsCorregibles = (items: readonly CalibracionHoja[]): { ticket: number; fecha: string }[] =>
  items.flatMap((c) => (c.origen === 'desk' && c.estado !== 'anulada' && c.ticket !== null ? [{ ticket: c.ticket, fecha: c.fecha }] : [])).sort((a, b) => b.fecha.localeCompare(a.fecha));

/** Lo que pasa al anular esa calibración, para decirlo antes de confirmar. */
export function efectoAnular(c: CalibracionHoja): string {
  const base = 'Deja de contar para la última calibración. No se borra, y no se puede desanular: si hace falta, se registra otra.';
  if (c.id < 0) return `${base} La hoja congelada no se toca: queda apuntado que esa fecha no vale.`;
  return c.origen === 'desk' ? `${base} Al traer las calibraciones de Desk 2.0 no volverá mientras el ticket n.º ${c.ticket} siga con esa fecha en Zoho.` : base;
}

/** De dónde sale una calibración del historial de un equipo. */
export function origenCalibracion(c: Pick<CalibracionHistorial, 'origen' | 'ticket' | 'corrigeTicket'>): string {
  if (c.origen === 'fst022') return 'F-ST-022';
  if (c.origen === 'desk') return `Ticket n.º ${c.ticket}`;
  return c.corrigeTicket === null ? 'Manual' : `Manual (corrige el ticket n.º ${c.corrigeTicket})`;
}
