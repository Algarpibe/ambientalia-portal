/**
 * Calibraciones desde Desk 2.0 (lote 9c): lo que calcula la tarjeta
 * «Calibraciones · Desk 2.0» de Configuración a partir del plan que da el
 * servidor. Puro, sin reloj ni red: la regla en sí es de hub-api (`calibraciones.ts`).
 */
import type { PasadaCalibraciones, RecuentosCalibraciones } from '../dominio';
import type { LineaPlan } from './maestro';
import { fmtFechaHora } from './vistas';

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
