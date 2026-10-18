/**
 * Pasadas nocturnas (lote 10): la DECISIÓN, pura. Cada noche, a las 02:00 de
 * Colombia, se calcula el plan del maestro de equipos y el de las calibraciones
 * desde Desk 2.0 (los mismos de la tarjeta de Configuración) y aquí se decide,
 * sólo con sus recuentos, si se aplica solo («limpio») o se RETIENE para que lo
 * mire una persona y lo aplique con el botón de siempre. Quien la ejecuta es
 * pasadas-nocturnas-repo.ts; cuándo, programador-pasadas.ts.
 *
 * Criterios (decisión de Alfonso, lote 10):
 *   · maestro: retiene si hay altas, cambios de serial o de activo, clientes que
 *     pasan a OTRO nombre, o más ambiguos que en la última sincronización
 *     aplicada; lo mismo en las otras marcas (altas, serial, activo, ambiguos).
 *     Los cambios de modelo y de cliente que sólo es otra forma de escribir el
 *     nombre se aplican solos. Además (prudencia del lote, revisable): retiene
 *     si algún contacto puesto a mano se quedaría sin equipos, porque entonces
 *     ese cliente dejaría de usar el contacto que alguien le puso, sin que
 *     nadie lo vea.
 *   · calibraciones: retiene si la salud de la lectura avisa o bloquea, si hay
 *     fechas cambiadas, vaciadas, re-enlazadas o en revisión (que son todas las
 *     anulaciones del plan: anular = cambiadas + reenlazadas + vaciadas) o más
 *     de `NUEVAS_MAX` nuevas. Sólo nuevas, hasta ese tope: limpio. Además
 *     (prudencia del lote, revisable): retiene si nacen filas de punto de
 *     partida, que no son «nuevas» de un ticket. Los recuentos pasivos (sin
 *     equipo, ilegibles, no resucitan, historial…) no retienen.
 *   · un plan que no escribe nada es «sin cambios» y no se aplica.
 *
 * Sin imports más que de tipos: la app lee de aquí la forma de lo que devuelve
 * la API. Nada de aquí envía nada a nadie.
 */
import type { RecuentosCalibraciones, SaludLectura } from './calibraciones.js';
import type { CampoMaestro, RecuentosMaestro, RecuentosOtras } from './maestro.js';

export const TIPOS_PASADA = ['maestro', 'calibraciones'] as const;
export type TipoPasada = (typeof TIPOS_PASADA)[number];
export const RESULTADOS_PASADA = ['en_curso', 'aplicada', 'sin_cambios', 'retenida', 'no_disponible', 'error'] as const;
export type ResultadoPasada = (typeof RESULTADOS_PASADA)[number];

/** La firma de lo que aplica una pasada nocturna: en `por` de la auditoría sale este texto, y ningún usuario. */
export const ACTOR_NOCTURNO: { userId: null; email: string } = { userId: null, email: 'Pasada automática' };

/** Más calibraciones nuevas que éstas en una noche ya no son normales: se retienen. */
export const NUEVAS_MAX = 30;

/** Lo que se decide: si escribiría algo, si se puede aplicar solo y, si no, por qué (en español, para la tarjeta). */
export interface Decision { escribe: boolean; limpio: boolean; motivos: string[] }

/** La última pasada nocturna de un tipo, tal como la enseñan las tarjetas de Configuración. */
export interface PasadaNocturna { fecha: string; resultado: ResultadoPasada; motivos: string[]; empezo: string; termino: string | null }
/** Las respuestas de GET /maestro/plan y GET /calibraciones/plan llevan, además, la última nocturna de su tipo. */
export type ConNocturna<T> = T & { nocturna: PasadaNocturna | null };

const decidir = (escribe: boolean, motivos: string[]): Decision => ({ escribe, limpio: motivos.length === 0, motivos: escribe ? motivos : [] });
const cambios = (c: Record<CampoMaestro, number>): number => c.cliente + c.modelo + c.serial + c.activo;

/**
 * El maestro. `ultima` = los recuentos de la última sincronización aplicada (a
 * mano o de noche), con su `otras`; null si nunca se aplicó ninguna: entonces
 * cualquier ambiguo retiene, porque no hay con qué comparar.
 */
export function decidirMaestro(r: RecuentosMaestro, otras: RecuentosOtras, ultima: RecuentosMaestro | null): Decision {
  const escribe = r.enlaces + r.altas + cambios(r.cambios) + otras.altas + cambios(otras.cambios) > 0;
  const motivos: string[] = [];
  const si = (n: number, texto: string): void => void (n > 0 && motivos.push(`${texto}: ${n}`));
  const sube = (ahora: number, antes: number | undefined, texto: string): void => {
    if (ultima === null ? ahora > 0 : ahora > (antes ?? 0)) motivos.push(`${texto}: ${ahora} (${ultima === null ? 'ninguna sincronización aplicada antes' : `en la última sincronización aplicada, ${antes ?? 0}`})`);
  };
  si(r.altas, 'Equipos nuevos que se darían de alta (GRIMM EDM 180)');
  si(r.cambios.serial, 'Cambios de serial (GRIMM EDM 180)');
  si(r.cambios.activo, 'Cambios de activo / inactivo (GRIMM EDM 180)');
  si(r.clienteOtroNombre, 'Clientes que pasarían a otro nombre (no sólo otra forma de escribirlo)');
  si(r.contactosSinEquipos, 'Contactos puestos a mano que se quedarían sin equipos');
  sube(r.ambiguosMaestro, ultima?.ambiguosMaestro, 'Seriales repetidos en Desk 2.0');
  sube(r.ambiguosPortal, ultima?.ambiguosPortal, 'Seriales repetidos en el portal');
  si(otras.altas, 'Otras marcas · equipos nuevos que se darían de alta');
  si(otras.cambios.serial, 'Otras marcas · cambios de serial');
  si(otras.cambios.activo, 'Otras marcas · cambios de activo / inactivo');
  sube(otras.ambiguos, ultima?.otras?.ambiguos, 'Otras marcas · seriales repetidos');
  return decidir(escribe, motivos);
}

/** Las calibraciones, con la salud de esa misma lectura. */
export function decidirCalibraciones(r: RecuentosCalibraciones, salud: SaludLectura): Decision {
  const escribe = r.nuevas + r.cambiadas + r.reenlazadas + r.vaciadas + r.partida > 0;
  const motivos: string[] = [];
  const si = (n: number, texto: string): void => void (n > 0 && motivos.push(`${texto}: ${n}`));
  if (salud.alerta || salud.bloquea) motivos.push(salud.mensaje ?? 'La lectura de Desk 2.0 no trae ninguna «Fecha de Calibración».');
  si(r.cambiadas, 'Fechas cambiadas en Zoho');
  si(r.vaciadas, 'Fechas vaciadas en Zoho (se anularían)');
  si(r.reenlazadas, 'Re-enlazadas (cambió su equipo o su revisión)');
  si(r.enRevision, 'En revisión (fecha futura o imposible, o serial en dos equipos)');
  si(r.partida, 'Filas de punto de partida nuevas');
  if (r.nuevas > NUEVAS_MAX) motivos.push(`Calibraciones nuevas: ${r.nuevas} (más de ${NUEVAS_MAX})`);
  return decidir(escribe, motivos);
}
