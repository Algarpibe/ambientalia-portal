/**
 * Maestro de equipos desde Desk 2.0 (lote 9b): lo que calcula la tarjeta
 * «Maestro de equipos · Desk 2.0» de Configuración a partir del plan que da el
 * servidor. Puro, sin reloj ni red: el cruce en sí es de hub-api (`maestro.ts`).
 */
import type { CambioMaestro, RecuentosMaestro, SincronizacionMaestro } from '../dominio';
import { fmtFechaHora } from './vistas';

export interface LineaPlan {
  texto: string;
  valor: string;
  /** Sincronizar cambiaría algo por esta línea (un número mayor que cero de algo que se escribe). */
  cambia: boolean;
}

const totalCambios = (r: RecuentosMaestro): number => r.cambios.cliente + r.cambios.modelo + r.cambios.serial + r.cambios.activo;

/** ¿Sincronizar escribiría algo en el inventario? Si no, sólo confirmaría lo que ya hay. */
export const hayQueAplicar = (r: RecuentosMaestro): boolean => r.enlaces + r.altas + totalCambios(r) > 0;

/** El plan, en el orden en que se lee. Sólo rótulos y números: nada de aquí lleva un cliente ni un serial. */
export function lineasPlan(r: RecuentosMaestro): LineaPlan[] {
  const dato = (texto: string, valor: number | string): LineaPlan => ({ texto, valor: String(valor), cambia: false });
  const escribe = (texto: string, valor: number): LineaPlan => ({ texto, valor: String(valor), cambia: valor > 0 });
  return [
    dato('GRIMM EDM 180 en Desk 2.0', r.maestro),
    dato('Equipos en el inventario del portal', r.portal),
    dato('Casan', r.casan),
    escribe('· se enlazan ahora con su equipo de Desk 2.0', r.enlaces),
    escribe('· les cambia el cliente', r.cambios.cliente),
    dato('· de ellos, cambian de cliente de verdad (no sólo cómo se escribe)', r.cambianDeCliente),
    escribe('· les cambia el modelo', r.cambios.modelo),
    escribe('· les cambia cómo se escribe el serial', r.cambios.serial),
    escribe('· cambian de activo a inactivo, o al revés', r.cambios.activo),
    escribe('Altas (sólo en Desk 2.0; nacen sin fecha de calibración)', r.altas),
    dato('Sólo en el portal (no se tocan)', `${r.soloPortal} (${r.soloPortalActivos} activos)`),
    dato('Ambiguos, con el serial repetido (no se tocan)', `${r.ambiguosMaestro} en Desk 2.0 · ${r.ambiguosPortal} en el portal`),
    ...(r.sinSerial > 0 ? [dato('Sin serial válido en Desk 2.0 (no entran)', r.sinSerial)] : []),
    dato('Inactivos en Desk 2.0', r.inactivos),
    dato('Contactos puestos a mano que se quedarían sin equipos', r.contactosSinEquipos),
  ];
}

/** La última sincronización: quién, cuándo (hora de Colombia) y qué aplicó. */
export function textoUltima(u: SincronizacionMaestro): string {
  const r = u.recuentos;
  return `${u.por} · ${fmtFechaHora(u.en)} · ${hayQueAplicar(r) ? `${r.enlaces} enlazados, ${totalCambios(r)} cambios y ${r.altas} altas` : 'sin cambios'}`;
}

/** Un cambio del detalle (sólo lo recibe quien puede sincronizar). */
export const textoCambio = (c: CambioMaestro): string => (c.campo === 'alta' ? `alta: ${c.despues}` : `${c.campo}: «${c.antes}» → «${c.despues}»`);
