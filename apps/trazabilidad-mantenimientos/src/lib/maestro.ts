/**
 * Maestro de equipos desde Desk 2.0 (lote 9b): lo que calcula la tarjeta
 * «Maestro de equipos · Desk 2.0» de Configuración a partir del plan que da el
 * servidor. Puro, sin reloj ni red: el cruce en sí es de hub-api (`maestro.ts`).
 */
import { mismoNombre, type CambioMaestro, type FilaHojaRevisar, type RecuentosMaestro, type RecuentosOtras, type SincronizacionMaestro } from '../dominio';
import { fmtFechaHora } from './vistas';

export interface LineaPlan {
  texto: string;
  valor: string;
  /** Sincronizar cambiaría algo por esta línea (un número mayor que cero de algo que se escribe). */
  cambia: boolean;
  /** Mayor que cero y conviene mirarlo antes de sincronizar: se resalta. */
  aviso: boolean;
}

const totalCambios = (r: Pick<RecuentosMaestro, 'cambios'>): number => r.cambios.cliente + r.cambios.modelo + r.cambios.serial + r.cambios.activo;

/** ¿Sincronizar escribiría algo en el inventario? Si no, sólo confirmaría lo que ya hay. */
export const hayQueAplicar = (r: RecuentosMaestro): boolean => r.enlaces + r.altas + totalCambios(r) > 0;
/** Lo mismo para las otras marcas (fuera de seguimiento): altas o cambios en las ya enlazadas. */
export const hayQueAplicarOtras = (o: RecuentosOtras): boolean => o.altas + totalCambios(o) > 0;

const dato = (texto: string, valor: number | string): LineaPlan => ({ texto, valor: String(valor), cambia: false, aviso: false });
const escribe = (texto: string, valor: number): LineaPlan => ({ texto, valor: String(valor), cambia: valor > 0, aviso: false });
const mirar = (texto: string, valor: number): LineaPlan => ({ texto, valor: String(valor), cambia: false, aviso: valor > 0 });

/**
 * El segundo bloque del plan (lote 9d-2a): las otras marcas de Desk 2.0, que se
 * enlazan FUERA de seguimiento. Sólo rótulos y números.
 */
export function lineasOtras(o: RecuentosOtras): LineaPlan[] {
  return [
    dato('Equipos de otras marcas en Desk 2.0', o.maestro),
    dato('Ya enlazados en el portal (fuera de seguimiento)', o.portal),
    escribe('Se enlazan ahora (altas fuera de seguimiento; sin fecha de calibración)', o.altas),
    escribe('Cambios en los ya enlazados (cliente, modelo, serial o activo)', totalCambios(o)),
    mirar('Con el serial repetido: no se enlazan, quedan para revisar', o.ambiguos),
    ...(o.sinSerial > 0 ? [dato('Sin serial válido en Desk 2.0 (no se enlazan)', o.sinSerial)] : []),
    dato('Inactivos en Desk 2.0 (no se enlazan)', o.inactivos),
    mirar('Ya no están en Desk 2.0 (no se tocan)', o.soloPortal),
  ];
}

/** Las filas de la hoja congelada que no quedarían enlazadas, por motivo: lo delicado (repetidas y numéricas dudosas) se enseña primero. */
export function bloquesHoja(revisar: readonly FilaHojaRevisar[]): Record<FilaHojaRevisar['motivo'], FilaHojaRevisar[]> {
  const de = (motivo: FilaHojaRevisar['motivo']) => revisar.filter((f) => f.motivo === motivo);
  return { repetido: de('repetido'), sin_ceros: de('sin_ceros'), solo_hoja: de('solo_hoja') };
}

/** Una de esas filas, en una línea: marca y serial (como en la hoja), y su cliente. */
export const textoFilaHoja = (f: FilaHojaRevisar): [string, string] => [`${f.marca || '(sin marca)'} · ${f.serial || '(sin serial)'}`, f.cliente || '(sin cliente)'];

/** El plan, en el orden en que se lee. Sólo rótulos y números: nada de aquí lleva un cliente ni un serial. */
export function lineasPlan(r: RecuentosMaestro): LineaPlan[] {
  return [
    dato('GRIMM EDM 180 en Desk 2.0', r.maestro),
    dato('Equipos en el inventario del portal', r.portal),
    dato('Casan', r.casan),
    escribe('· se enlazan ahora con su equipo de Desk 2.0', r.enlaces),
    escribe('· les cambia el nombre del cliente', r.cambios.cliente),
    mirar('· de ellos, con otro nombre (no sólo mayúsculas, tildes, puntuación o forma societaria: S.A.S., Ltda., BIC…)', r.clienteOtroNombre),
    escribe('· les cambia el modelo', r.cambios.modelo),
    escribe('· les cambia cómo se escribe el serial', r.cambios.serial),
    escribe('· cambian de activo a inactivo, o al revés', r.cambios.activo),
    mirar('Altas (sólo en Desk 2.0; nacen sin fecha de calibración)', r.altas),
    dato('Sólo en el portal (no se tocan)', `${r.soloPortal} (${r.soloPortalActivos} activos)`),
    dato('Ambiguos, con el serial repetido (no se tocan)', `${r.ambiguosMaestro} en Desk 2.0 · ${r.ambiguosPortal} en el portal`),
    dato('Copias inactivas con el serial de otro equipo (no se tocan)', r.copiasInactivas ?? 0),
    ...(r.sinSerial > 0 ? [dato('Sin serial válido en Desk 2.0 (no entran)', r.sinSerial)] : []),
    dato('Inactivos en Desk 2.0', r.inactivos),
    mirar('Contactos puestos a mano que se quedarían sin equipos', r.contactosSinEquipos),
  ];
}

/**
 * El detalle de los cambios, repartido como se enseña al confirmar: las altas
 * primero (son equipos nuevos en el inventario), los clientes a los que el
 * nombre les cambia por otro, el resto de cambios (modelo, serial, activo) y,
 * aparte, los clientes que sólo cambian de forma de escribirse o de forma societaria.
 */
export function bloquesDetalle(detalle: readonly CambioMaestro[]): Record<'altas' | 'otroNombre' | 'otros' | 'mismaForma', CambioMaestro[]> {
  const cliente = detalle.filter((c) => c.campo === 'cliente');
  return {
    altas: detalle.filter((c) => c.campo === 'alta'),
    otroNombre: cliente.filter((c) => !mismoNombre(c.antes, c.despues)),
    otros: detalle.filter((c) => c.campo !== 'alta' && c.campo !== 'cliente'),
    mismaForma: cliente.filter((c) => mismoNombre(c.antes, c.despues)),
  };
}

/** La última sincronización: quién, cuándo (hora de Colombia) y qué aplicó; si hizo algo con las otras marcas, también (las de antes del lote 9d-2a no las llevan). */
export function textoUltima(u: SincronizacionMaestro): string {
  const r = u.recuentos;
  const o = r.otras && hayQueAplicarOtras(r.otras) ? r.otras : null;
  const seguimiento = hayQueAplicar(r) ? `${r.enlaces} enlazados, ${totalCambios(r)} cambios y ${r.altas} altas` : `sin cambios${o ? ' en GRIMM EDM 180' : ''}`;
  return `${u.por} · ${fmtFechaHora(u.en)} · ${seguimiento}${o ? ` · otras marcas: ${o.altas} enlazadas y ${totalCambios(o)} cambios` : ''}`;
}

/** Un cambio del detalle (sólo lo recibe quien puede sincronizar). */
export const textoCambio = (c: CambioMaestro): string => (c.campo === 'alta' ? `alta: ${c.despues}` : `${c.campo}: «${c.antes}» → «${c.despues}»`);
