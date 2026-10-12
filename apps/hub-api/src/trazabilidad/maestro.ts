/**
 * Maestro de equipos (lote 9b): la regla pura del cruce entre `desk.equipos`
 * de Desk 2.0 y el inventario del portal (`portal.tmc_equipos`). Sin base,
 * sin reloj y sin más import que dominio.ts (y un tipo de fuente.ts): la app
 * lee de aquí los tipos.
 *
 * Dos ámbitos en el mismo plan (12/10/2026, lote 9d-2a):
 *  - EN SEGUIMIENTO: los GRIMM EDM 180, como siempre (opción A del 10/10/2026).
 *    Todo lo que sigue hasta «Otras marcas» habla de ellos y no ha cambiado.
 *  - OTRAS MARCAS (`plan.otras`): lo demás del maestro. Se enlazan también,
 *    pero FUERA de seguimiento (columna `en_seguimiento`, migración 058): sólo
 *    para que la pestaña «Trazabilidad F-ST-022» enseñe su cliente, marca,
 *    modelo y serial del maestro. No entran en Resumen, Equipos, Calendario ni
 *    Avisos. Ver `planOtras`.
 * Nadie cambia de ámbito por sincronizar.
 *
 * Un equipo del maestro casa con uno del portal (1) por su id de Desk 2.0, si
 * el portal ya lo guardó en una sincronización anterior (así una corrección
 * del serial allí no crea un equipo nuevo), y si no (2) por serial con
 * `serialNorm` (dominio.ts): mayúsculas y sin espacios alrededor, lo mismo
 * que `upper(trim(…))`, la regla con que el portal ya cruza con los tickets
 * de Desk y la que guardó la congelación. Un serial repetido en el maestro es
 * AMBIGUO: no se enlaza ni se toca. Repetido en el portal, casa con su única
 * fila ACTIVA (las inactivas son copias retiradas: ni se tocan ni cuentan como
 * ambiguas); con dos o más activas, o con ninguna, también es ambiguo. Lo que
 * sólo está en el portal tampoco se toca. La fecha de calibración no es de
 * aquí (lote 9c). Cualquier corrección de un equipo se hace en Desk 2.0.
 */
import { claveCliente, claveSerial, serialNorm } from './dominio.js';
import type { MotivoRespaldo } from './fuente.js';

/** Tope de la `clave` de tmc_equipos (y de `esClave`): un serial más largo no puede entrar. */
export const CLAVE_MAX = 80;
const CLIENTE_MAX = 200;
/** Tope de `marca` y `modelo` en tmc_equipos. */
const TEXTO_MAX = 60;
const SIN_CLIENTE = '(sin cliente en Desk 2.0)';

/**
 * El modelo tal como venga escrito («EDM180C» en Desk 2.0, «EDM 180C»,
 * «edm 180 d»…) → la forma del portal, «EDM 180C» / «EDM 180D»; null si no es
 * un EDM 180 (el EDM 280 o el 1109 quedan fuera).
 */
export function modeloEdm180(modelo: unknown): string | null {
  const m = /^(?:GRIMM)?EDM180([A-Z]{0,2})$/.exec(String(modelo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  return m ? `EDM 180${m[1]}` : null;
}

/** GRIMM EDM 180: el modelo lo es y la marca dice GRIMM (o no dice nada: ese modelo sólo lo fabrica GRIMM). */
export function esGrimmEdm180(marca: unknown, modelo: unknown): boolean {
  const mk = String(marca ?? '').trim().toLowerCase();
  return modeloEdm180(modelo) !== null && (mk === '' || mk.includes('grimm'));
}

/** Un equipo de `desk.equipos`, con lo único que el portal lee de él. */
export interface EquipoMaestro { id: string; serial: string; marca: string | null; modelo: string | null; cliente: string | null; activo: boolean }
/** Un equipo del inventario del portal, activo o no; `deskId` es el id de su equipo en Desk 2.0, si ya se enlazó. */
export interface EquipoPortal { clave: string; serial: string; cliente: string; modelo: string; activo: boolean; deskId: string | null; /** `false` = otra marca, fuera de seguimiento (058); si falta, en seguimiento. */ enSeguimiento?: boolean }

export const CAMPOS_MAESTRO = ['cliente', 'modelo', 'serial', 'activo'] as const;
export type CampoMaestro = (typeof CAMPOS_MAESTRO)[number];
/** Un cambio del plan, para revisar antes y para la auditoría después. Lleva cliente y serial. `ambito: 'otras'` = de un equipo fuera de seguimiento; sin él, del seguimiento. */
export interface CambioMaestro { clave: string; campo: CampoMaestro | 'alta'; antes: string | null; despues: string | null; ambito?: 'otras' }

/** El plan en números: nada de aquí lleva un cliente ni un serial. */
export interface RecuentosMaestro {
  /** GRIMM EDM 180 que hay en el maestro, y filas del inventario del portal (activas o no). */
  maestro: number;
  portal: number;
  casan: number;
  /** De los que casan: los que se enlazan ahora (aún no lo estaban con ese equipo) y a cuántos les cambia cada campo. */
  enlaces: number;
  cambios: Record<CampoMaestro, number>;
  /** Sólo en Desk 2.0 y activos: se dan de alta. */
  altas: number;
  /** Sólo en el portal: no se tocan. */
  soloPortal: number;
  soloPortalActivos: number;
  /** Con el serial repetido sin que se sepa cuál es cuál: no se enlazan ni se tocan (ver `planMaestro`). */
  ambiguosMaestro: number;
  ambiguosPortal: number;
  /** Filas INACTIVAS del portal con el serial de otra fila que es la que vale (la única activa o la ya enlazada): no se tocan ni son ambiguas. */
  copiasInactivas: number;
  /** Del maestro, sin serial o con uno más largo que la clave. */
  sinSerial: number;
  inactivos: number;
  /** De `cambios.cliente`, a los que el nombre les cambia por otro: no es sólo mayúsculas, tildes, puntuación o forma societaria (`mismoNombre`). */
  clienteOtroNombre: number;
  /** Contactos puestos a mano cuyo cliente tiene hoy algún equipo activo y dejaría de tenerlo. */
  contactosSinEquipos: number;
  /** Sólo en la auditoría de una sincronización aplicada desde el lote 9d-2a: lo que se hizo con las otras marcas. En el plan va aparte (`plan.otras`). */
  otras?: RecuentosOtras;
}

/** Lo que se escribe en un equipo que casa (todo sale del maestro menos la clave) y en un alta. */
export interface FilaEnlace { clave: string; deskId: string; serial: string; cliente: string; modelo: string; activo: boolean }
export type FilaAlta = Omit<FilaEnlace, 'activo'> & { marca: string };
/** Un equipo que el plan NO toca, para revisarlo: del portal (`clave` = la suya) o de Desk 2.0 (`clave` = su id allí). Lleva cliente y serial. */
export interface EquipoRevisar { origen: 'portal' | 'desk'; clave: string; serial: string; cliente: string; activo: boolean }
/** El plan de las otras marcas en números (sin clientes ni seriales). `maestro`: las que hay en Desk 2.0; `portal`: filas fuera de seguimiento. */
export interface RecuentosOtras {
  maestro: number;
  portal: number;
  /** Ya enlazadas: se actualizan como las demás (a cuántas les cambia cada campo). */
  casan: number;
  cambios: Record<CampoMaestro, number>;
  /** Activas en Desk 2.0 y aún no en el portal: se dan de alta FUERA de seguimiento, sin fecha de calibración. */
  altas: number;
  /** Fuera de seguimiento en el portal y ya no en Desk 2.0: no se tocan. */
  soloPortal: number;
  /** No se dan de alta: su serial se repite en el maestro o ya es de otro equipo del portal. */
  ambiguos: number;
  sinSerial: number;
  /** Inactivas en Desk 2.0 que el portal no tiene: no se dan de alta. */
  inactivos: number;
}
export interface PlanOtras { recuentos: RecuentosOtras; enlaces: FilaEnlace[]; altas: FilaAlta[]; cambios: CambioMaestro[]; soloPortal: EquipoRevisar[]; ambiguos: EquipoRevisar[] }

/** Una fila de equipo de la hoja congelada, para el cruce: su marca, su `serial_norm`, su cliente y la clave que le dio la importación. */
export interface FilaHojaCruce { marca: unknown; serial: string | null; cliente: string; claveEquipo: string | null }
/** El cruce de la hoja con el inventario tal como quedaría, por marca y sólo en recuentos de FILAS de la hoja. */
export interface CruceHojaMarca {
  marca: string;
  filas: number;
  /** Quedarían enlazadas con un equipo (cliente, marca, modelo y serial del maestro en la pestaña). */
  enlazadas: number;
  /** Siguen sólo en la hoja: sin equipo activo en Desk 2.0. De ellas, `sinCeros` casarían ignorando los ceros a la izquierda de un serial numérico: NO se enlazan. */
  soloHoja: number;
  sinCeros: number;
  /** No se enlazan porque su serial se repite (en la hoja, en el maestro o en el portal). */
  repetidas: number;
}
/** Una fila de la hoja que no quedaría enlazada, para revisarla. Lleva cliente y serial. */
export interface FilaHojaRevisar { motivo: 'repetido' | 'sin_ceros' | 'solo_hoja'; marca: string; serial: string; cliente: string }
export interface CruceHoja { marcas: CruceHojaMarca[]; revisar: FilaHojaRevisar[] }

export interface PlanMaestro { recuentos: RecuentosMaestro; enlaces: FilaEnlace[]; altas: FilaAlta[]; cambios: CambioMaestro[]; soloPortal: EquipoRevisar[]; ambiguos: EquipoRevisar[]; otras: PlanOtras; hoja: CruceHoja }

/** Formas societarias y coletillas que se quitan del final de un nombre para compararlo (ya sin puntos: «S.A.S.» es `sas`). */
const FORMAS_SOCIETARIAS = new Set(['sas', 'sa', 'ltda', 'limitada', 'bic', 'esp', 'eu', 'sca', 'scs', 'cia', 'y']);

/**
 * Un nombre de cliente reducido a lo que lo distingue: `claveCliente` (sin
 * mayúsculas ni tildes), sin puntuación y sin la forma societaria del final
 * (S.A.S., S.A., Ltda., BIC, E.S.P., «y Cía»…). Nunca lo deja vacío.
 */
function nucleoNombre(nombre: unknown): string {
  const palabras = claveCliente(nombre).replace(/\./g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\bs a s\b/g, 'sas').replace(/\bs a\b/g, 'sa').replace(/\be s p\b/g, 'esp').split(' ').filter(Boolean);
  while (palabras.length > 1 && FORMAS_SOCIETARIAS.has(palabras[palabras.length - 1])) palabras.pop();
  return palabras.join(' ');
}

/**
 * ¿Dos nombres de cliente son el mismo, escrito de otra forma? Sólo se
 * igualan mayúsculas, tildes, espacios, puntuación y la forma societaria (el
 * maestro trae razones sociales; la Excel, nombres cortos). NO adivina que
 * unas siglas, un nombre más largo o una errata sean el mismo cliente.
 */
export function mismoNombre(a: unknown, b: unknown): boolean {
  return nucleoNombre(a) === nucleoNombre(b);
}

const limpio = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
const texto = (v: string | boolean): string => (typeof v !== 'boolean' ? v : v ? 'sí' : 'no');
const veces = (seriales: readonly string[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const s of seriales) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
};

/**
 * El plan: qué casa, qué cambiaría, qué se daría de alta y qué se queda fuera. `contactos` son las claves de cliente con contacto
 * puesto a mano. Misma entrada (en cualquier orden) → mismo plan; con el plan aplicado, el siguiente no trae nada.
 */
export function planMaestro(maestro: readonly EquipoMaestro[], portal: readonly EquipoPortal[], contactos: readonly string[], hoja: readonly FilaHojaCruce[] = []): PlanMaestro {
  // Cada fila del portal está en un ámbito y no sale de él: lo ya enlazado fuera de seguimiento no vuelve por aquí aunque el maestro lo dé ahora como
  // EDM 180, y este ámbito sólo ve las filas en seguimiento. Todos los recuentos de `r` (clientes y contactos incluidos) son, por tanto, sólo suyos.
  const fuera = portal.filter((p) => p.enSeguimiento === false);
  const idsFuera = new Set(fuera.map((p) => p.deskId));
  const m = maestro.filter((e) => esGrimmEdm180(e.marca, e.modelo) && !idsFuera.has(e.id)).sort((a, b) => a.id.localeCompare(b.id));
  const inventario = portal.filter((p) => p.enSeguimiento !== false).sort((a, b) => a.clave.localeCompare(b.clave));
  const enMaestro = veces(m.map((e) => serialNorm(e.serial)));
  const enPortal = veces(inventario.map((p) => serialNorm(p.serial)));
  const porDeskId = new Map(inventario.filter((p) => p.deskId).map((p) => [p.deskId, p]));
  const r: RecuentosMaestro = {
    maestro: m.length, portal: inventario.length, casan: 0, enlaces: 0, cambios: { cliente: 0, modelo: 0, serial: 0, activo: 0 }, altas: 0,
    soloPortal: 0, soloPortalActivos: 0, ambiguosMaestro: 0, ambiguosPortal: 0, copiasInactivas: 0, sinSerial: 0, inactivos: m.filter((e) => !e.activo).length, clienteOtroNombre: 0, contactosSinEquipos: 0,
  };
  const delSerial = new Map<string, EquipoPortal[]>();
  for (const p of inventario) delSerial.set(serialNorm(p.serial), [...(delSerial.get(serialNorm(p.serial)) ?? []), p]);
  const soloPortal: EquipoRevisar[] = [];
  const ambiguos: EquipoRevisar[] = [];

  // 1. Por id de Desk 2.0. 2. Los demás, por serial. Si el portal repite el serial, vale su ÚNICA fila
  // activa (las inactivas son copias que dejó retiradas una reimportación antigua); con dos o más
  // activas, con ninguna, o si el serial se repite en el maestro, es ambiguo y no se toca.
  const pares = new Map<string, EquipoMaestro>();
  const sueltos = m.filter((e) => {
    const p = porDeskId.get(e.id);
    if (p) pares.set(p.clave, e);
    return !p;
  });
  const nuevos: EquipoMaestro[] = [];
  for (const e of sueltos) {
    const s = serialNorm(e.serial);
    const filas = delSerial.get(s) ?? [];
    const activas = filas.filter((p) => p.activo);
    const p = filas.length === 1 ? filas[0] : activas.length === 1 ? activas[0] : null;
    if (s === '' || s.length > CLAVE_MAX) r.sinSerial++;
    else if (enMaestro.get(s) === 1 && filas.length === 0) {
      if (e.activo) nuevos.push(e);
    } else if (enMaestro.get(s) === 1 && p && !pares.has(p.clave)) pares.set(p.clave, e);
    // También es ambiguo el que trae el serial de un equipo del portal ya enlazado con otro.
    else ambiguos.push({ origen: 'desk', clave: e.id, serial: e.serial.trim(), cliente: limpio(e.cliente), activo: e.activo });
  }
  r.ambiguosMaestro = ambiguos.length;

  const enlaces: FilaEnlace[] = [];
  const cambios: CambioMaestro[] = [];
  /** El cliente (por su clave) de cada equipo activo, antes y después: de aquí salen los contactos que se quedan sin equipos. */
  const antes = new Set<string>();
  const despues = new Set<string>();
  for (const p of inventario) {
    if (p.activo) antes.add(claveCliente(p.cliente));
    const e = pares.get(p.clave);
    if (!e) {
      const s = serialNorm(p.serial);
      // De las filas con su serial, las que «valen»: la ya enlazada o la activa. Si es una sola y no es ésta, ésta es su copia inactiva.
      const valen = (delSerial.get(s) ?? []).filter((x) => pares.has(x.clave) || x.activo);
      const yo: EquipoRevisar = { origen: 'portal', clave: p.clave, serial: p.serial, cliente: p.cliente, activo: p.activo };
      if ((enMaestro.get(s) ?? 0) > 1 || (enPortal.get(s)! > 1 && valen.length !== 1)) ambiguos.push(yo);
      else if (valen.length === 1 && valen[0] !== p) r.copiasInactivas++;
      else soloPortal.push(yo);
      if (p.activo) despues.add(claveCliente(p.cliente));
      continue;
    }
    const serial = e.serial.trim();
    const fila: FilaEnlace = { clave: p.clave, deskId: e.id, serial: serial === '' || serial.length > CLAVE_MAX ? p.serial : serial, cliente: limpio(e.cliente).slice(0, CLIENTE_MAX) || p.cliente, modelo: modeloEdm180(e.modelo)!, activo: e.activo };
    enlaces.push(fila);
    r.casan++;
    if (p.deskId !== e.id) r.enlaces++;
    if (!mismoNombre(fila.cliente, p.cliente)) r.clienteOtroNombre++;
    if (fila.activo) despues.add(claveCliente(fila.cliente));
    for (const campo of CAMPOS_MAESTRO) {
      if (fila[campo] === p[campo]) continue;
      r.cambios[campo]++;
      cambios.push({ clave: p.clave, campo, antes: texto(p[campo]), despues: texto(fila[campo]) });
    }
  }

  const claves = new Set(portal.map((p) => p.clave));
  const altas = nuevos.map((e): FilaAlta => {
    const serial = e.serial.trim();
    const clave = claveLibre(serial, claves);
    const cliente = limpio(e.cliente).slice(0, CLIENTE_MAX) || SIN_CLIENTE;
    despues.add(claveCliente(cliente));
    cambios.push({ clave, campo: 'alta', antes: null, despues: `${serial} · ${cliente}` });
    return { clave, deskId: e.id, serial, cliente, marca: limpio(e.marca).slice(0, 60) || 'GRIMM', modelo: modeloEdm180(e.modelo)! };
  });
  r.altas = altas.length;
  r.soloPortal = soloPortal.length;
  r.soloPortalActivos = soloPortal.filter((p) => p.activo).length;
  r.ambiguosPortal = ambiguos.length - r.ambiguosMaestro;
  r.contactosSinEquipos = contactos.filter((c) => antes.has(c) && !despues.has(c)).length;
  const otras = planOtras(maestro, inventario, fuera, claves);
  // El inventario entero tal como quedaría (los dos ámbitos), para decir qué filas de la hoja se enlazarían con un equipo.
  const serialDe = new Map([...enlaces, ...otras.enlaces].map((f) => [f.clave, f.serial]));
  const quedaria = [...portal.map((p) => ({ clave: p.clave, serial: serialDe.get(p.clave) ?? p.serial })), ...altas, ...otras.altas];
  return { recuentos: r, enlaces, altas, cambios, soloPortal, ambiguos, otras, hoja: cruceHoja(hoja, quedaria, maestro) };
}

/** Una clave libre para un alta: la de su serial (`claveSerial`, la función de siempre) y, si ya está cogida, con «-2», «-3»… Cabe siempre en su columna. */
function claveLibre(serial: string, claves: Set<string>): string {
  const base = claveSerial(serial).slice(0, CLAVE_MAX - 4); // sitio para el sufijo de una clave ya cogida
  let clave = base;
  for (let i = 2; claves.has(clave); i++) clave = `${base}-${i}`;
  claves.add(clave);
  return clave;
}

/**
 * OTRAS MARCAS: lo que el maestro tiene y no es un GRIMM EDM 180 (también un GRIMM de otro modelo), más lo que el portal ya enlazó fuera de
 * seguimiento. Se casa SÓLO por el id de Desk 2.0 (estas filas nacen enlazadas): las que casan se actualizan como las demás (cliente, modelo,
 * serial y activo, tal como los escribe el maestro) y las activas que el portal no tiene se dan de alta fuera de seguimiento. NO se da de alta
 * —es ambiguo, y sale para revisar— un equipo cuyo serial se repite en todo el maestro o ya está en otra fila del portal, de cualquier ámbito.
 * Lo que está fuera de seguimiento y ya no está en el maestro no se toca. `dentro` son las filas en seguimiento: sus equipos no son de aquí.
 */
function planOtras(maestro: readonly EquipoMaestro[], dentro: readonly EquipoPortal[], fuera: readonly EquipoPortal[], claves: Set<string>): PlanOtras {
  const idsDentro = new Set(dentro.map((p) => p.deskId));
  const porDeskId = new Map(fuera.map((p) => [p.deskId, p]));
  const m = maestro.filter((e) => porDeskId.has(e.id) || (!esGrimmEdm180(e.marca, e.modelo) && !idsDentro.has(e.id))).sort((a, b) => a.id.localeCompare(b.id));
  const enMaestro = veces(maestro.map((e) => serialNorm(e.serial)));
  const enPortal = new Set([...dentro, ...fuera].map((p) => serialNorm(p.serial)));
  const ids = new Set(maestro.map((e) => e.id));
  const soloPortal = fuera.filter((p) => !ids.has(p.deskId ?? '')).sort((a, b) => a.clave.localeCompare(b.clave)).map((p): EquipoRevisar => ({ origen: 'portal', clave: p.clave, serial: p.serial, cliente: p.cliente, activo: p.activo }));
  const r: RecuentosOtras = { maestro: m.length, portal: fuera.length, casan: 0, cambios: { cliente: 0, modelo: 0, serial: 0, activo: 0 }, altas: 0, soloPortal: soloPortal.length, ambiguos: 0, sinSerial: 0, inactivos: 0 };
  const plan: PlanOtras = { recuentos: r, enlaces: [], altas: [], cambios: [], soloPortal, ambiguos: [] };
  for (const e of m) {
    const p = porDeskId.get(e.id);
    const serial = e.serial.trim();
    const s = serialNorm(serial);
    const valido = s !== '' && s.length <= CLAVE_MAX;
    const cliente = limpio(e.cliente).slice(0, CLIENTE_MAX);
    const modelo = limpio(e.modelo).slice(0, TEXTO_MAX);
    if (p) {
      const fila: FilaEnlace = { clave: p.clave, deskId: e.id, serial: valido ? serial : p.serial, cliente: cliente || p.cliente, modelo: modelo || p.modelo, activo: e.activo };
      plan.enlaces.push(fila);
      r.casan++;
      for (const campo of CAMPOS_MAESTRO) {
        if (fila[campo] === p[campo]) continue;
        r.cambios[campo]++;
        plan.cambios.push({ clave: p.clave, campo, antes: texto(p[campo]), despues: texto(fila[campo]), ambito: 'otras' });
      }
    } else if (!e.activo) r.inactivos++;
    else if (!valido) r.sinSerial++;
    else if (enMaestro.get(s)! > 1 || enPortal.has(s)) plan.ambiguos.push({ origen: 'desk', clave: e.id, serial, cliente, activo: true });
    else {
      const alta: FilaAlta = { clave: claveLibre(serial, claves), deskId: e.id, serial, cliente: cliente || SIN_CLIENTE, marca: limpio(e.marca).slice(0, TEXTO_MAX) || '(sin marca)', modelo: modelo || '(sin modelo)' };
      plan.altas.push(alta);
      plan.cambios.push({ clave: alta.clave, campo: 'alta', antes: null, despues: `${serial} · ${alta.cliente}`, ambito: 'otras' });
    }
  }
  r.altas = plan.altas.length;
  r.ambiguos = plan.ambiguos.length;
  return plan;
}

const ORDEN_REVISAR: FilaHojaRevisar['motivo'][] = ['repetido', 'sin_ceros', 'solo_hoja'];

/**
 * Cruce de la hoja congelada con el inventario tal como QUEDARÍA al aplicar el plan (`quedaria`, los dos ámbitos): qué filas enlazaría la pestaña
 * con un equipo, con su misma regla (hoja.ts): por la clave que le dio la importación o por un serial que no se repita ni en la hoja ni en el
 * inventario. Las demás, para revisar: con el serial repetido, con un serial numérico que sólo casaría ignorando los ceros a la izquierda
 * (Excel no los conserva; NO se enlazan solas) y las que no tienen equipo activo en Desk 2.0. Cada fila cuenta en su marca.
 */
function cruceHoja(hoja: readonly FilaHojaCruce[], quedaria: readonly { clave: string; serial: string }[], maestro: readonly EquipoMaestro[]): CruceHoja {
  const marcas = new Map<string, CruceHojaMarca>();
  const revisar: FilaHojaRevisar[] = [];
  const enHoja = veces(hoja.map((f) => f.serial ?? ''));
  const enPortal = veces(quedaria.map((q) => serialNorm(q.serial)));
  const enMaestro = veces(maestro.map((e) => serialNorm(e.serial)));
  const claves = new Set(quedaria.map((q) => q.clave));
  const sueltos = new Set([...enMaestro.keys()].filter((s) => !enHoja.has(s)).map(sinCeros));
  for (const f of hoja) {
    const s = f.serial ?? '';
    const k = claveCliente(f.marca);
    const c = marcas.get(k) ?? { marca: limpio(f.marca) || '(sin marca)', filas: 0, enlazadas: 0, soloHoja: 0, sinCeros: 0, repetidas: 0 };
    marcas.set(k, c);
    c.filas++;
    const veo = (n: Map<string, number>): number => n.get(s) ?? 0;
    if ((f.claveEquipo !== null && claves.has(f.claveEquipo)) || (s !== '' && veo(enHoja) === 1 && veo(enPortal) === 1)) {
      c.enlazadas++;
      continue;
    }
    const repetida = s !== '' && (veo(enHoja) > 1 || veo(enPortal) > 1 || veo(enMaestro) > 1);
    const ceros = !repetida && sinCeros(s) !== null && sueltos.has(sinCeros(s));
    if (repetida) c.repetidas++;
    else c.soloHoja++;
    if (ceros) c.sinCeros++;
    revisar.push({ motivo: repetida ? 'repetido' : ceros ? 'sin_ceros' : 'solo_hoja', marca: limpio(f.marca), serial: s, cliente: f.cliente });
  }
  return { marcas: [...marcas.values()], revisar: revisar.sort((a, b) => ORDEN_REVISAR.indexOf(a.motivo) - ORDEN_REVISAR.indexOf(b.motivo)) };
}

/** Si el maestro contestó en esta petición y, si no, por qué (un motivo de la lista, nunca el error). */
export interface EstadoMaestro { disponible: boolean; motivo: MotivoRespaldo | null; mensaje: string | null }
/** Una sincronización aplicada, de la auditoría (`portal.tmc_maestro_sincronizaciones`): sólo quién, cuándo y recuentos. */
export interface SincronizacionMaestro { id: number; huella: string; recuentos: RecuentosMaestro; por: string; en: string }

/** GET /trazabilidad/maestro/plan. `detalle` (con clientes y seriales, acotado) sólo va para quien puede sincronizar. */
export interface RespuestaPlanMaestro {
  maestro: EstadoMaestro;
  /** null sin maestro. `huella` identifica el plan (los dos ámbitos): se manda al aplicarlo. `recuentos` es el ámbito en seguimiento; `otras`, las otras marcas; `hoja`, el cruce con la hoja congelada por marca. Sólo números. */
  plan: { huella: string; recuentos: RecuentosMaestro; otras: RecuentosOtras; hoja: CruceHojaMarca[] } | null;
  ultima: SincronizacionMaestro | null;
  detalle?: CambioMaestro[];
  detalleTotal?: number;
  /** También sólo con el permiso: lo que el plan no toca, equipo a equipo (acotado como `detalle`). */
  revisar?: { soloPortal: EquipoRevisar[]; ambiguos: EquipoRevisar[] };
  /** También sólo con el permiso, y aparte: el detalle de las otras marcas (sus altas y cambios), lo que no se toca de ellas y las filas de la hoja que no quedarían enlazadas. */
  otras?: { detalle: CambioMaestro[]; detalleTotal: number; soloPortal: EquipoRevisar[]; ambiguos: EquipoRevisar[]; hoja: FilaHojaRevisar[] };
}

/** Una marca del cruce informativo, sólo recuentos: filas de equipo de la congelación (`v3`) y equipos del maestro (`desk`) de esa marca. */
export interface CruceMarca {
  marca: string;
  v3: number;
  desk: number;
  casan: number;
  soloV3: number;
  soloDesk: number;
  /** Filas de los dos lados con un serial repetido en alguno. */
  ambiguos: number;
  /** De `soloV3`, las de serial numérico que casarían ignorando los ceros a la izquierda. */
  sinCeros: number;
}
/** GET /trazabilidad/maestro/cruce: la congelación vigente de la F-ST-022 frente al maestro, por marca. */
export interface RespuestaCruceFst022 { maestro: EstadoMaestro; congelacion: { id: number; archivo: string } | null; marcas: CruceMarca[] }

const sinCeros = (s: string): string | null => (/^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : null);

/**
 * Cruce INFORMATIVO de la congelación de la F-ST-022 con el maestro, de todas las marcas y por serial (`serialNorm`): lo que habrá que
 * revisar antes de traer las demás marcas (lote 9d). Cada fila cuenta en SU marca, en el orden en que aparecen; sin serial, sólo en su lado.
 */
export function cruceFst022(v3: readonly { marca: unknown; serial: unknown }[], maestro: readonly { marca: unknown; serial: unknown }[]): CruceMarca[] {
  const marcas = new Map<string, CruceMarca>();
  const de = (marca: unknown): CruceMarca => {
    const clave = claveCliente(marca);
    if (!marcas.has(clave)) marcas.set(clave, { marca: limpio(marca) || '(sin marca)', v3: 0, desk: 0, casan: 0, soloV3: 0, soloDesk: 0, ambiguos: 0, sinCeros: 0 });
    return marcas.get(clave)!;
  };
  const enV3 = veces(v3.map((f) => serialNorm(f.serial)));
  const enDesk = veces(maestro.map((e) => serialNorm(e.serial)));
  const repetido = (s: string) => (enV3.get(s) ?? 0) > 1 || (enDesk.get(s) ?? 0) > 1;
  const sueltosDesk = new Set(maestro.map((e) => serialNorm(e.serial)).filter((s) => s !== '' && !enV3.has(s)).map(sinCeros));
  for (const f of v3) {
    const s = serialNorm(f.serial);
    const c = de(f.marca);
    c.v3++;
    if (s !== '' && repetido(s)) c.ambiguos++;
    else if (s !== '' && enDesk.has(s)) c.casan++;
    else {
      c.soloV3++;
      if (sinCeros(s) !== null && sueltosDesk.has(sinCeros(s))) c.sinCeros++;
    }
  }
  for (const e of maestro) {
    const s = serialNorm(e.serial);
    const c = de(e.marca);
    c.desk++;
    if (s !== '' && repetido(s)) c.ambiguos++;
    else if (s === '' || !enV3.has(s)) c.soloDesk++;
  }
  return [...marcas.values()];
}
