/**
 * Maestro de equipos (lote 9b): la regla pura del cruce entre `desk.equipos`
 * de Desk 2.0 y el inventario del portal (`portal.tmc_equipos`). Sin base,
 * sin reloj y sin más import que dominio.ts (y un tipo de fuente.ts): la app
 * lee de aquí los tipos.
 *
 * Opción A (10/10/2026): al inventario sólo entran los GRIMM EDM 180. Las
 * demás marcas sólo se CUENTAN, en el cruce informativo con la congelación.
 *
 * Un equipo del maestro casa con uno del portal (1) por su id de Desk 2.0, si
 * el portal ya lo guardó en una sincronización anterior (así una corrección
 * del serial allí no crea un equipo nuevo), y si no (2) por serial con
 * `serialNorm` (dominio.ts): mayúsculas y sin espacios alrededor, lo mismo
 * que `upper(trim(…))`, la regla con que el portal ya cruza con los tickets
 * de Desk y la que guardó la congelación. Un serial repetido en cualquiera de
 * los dos lados es AMBIGUO: no se enlaza ni se toca. Lo que sólo está en el
 * portal tampoco. La fecha de calibración no es de aquí (lote 9c).
 */
import { claveCliente, claveSerial, serialNorm } from './dominio.js';
import type { MotivoRespaldo } from './fuente.js';

/** Tope de la `clave` de tmc_equipos (y de `esClave`): un serial más largo no puede entrar. */
export const CLAVE_MAX = 80;
const CLIENTE_MAX = 200;
const SIN_CLIENTE = '(sin cliente en Desk 2.0)';

/**
 * El modelo tal como venga escrito («EDM180C» en Desk 2.0, «EDM 180C»,
 * «edm 180 d»…) → la forma del portal, «EDM 180C» / «EDM 180D»; null si no es
 * un EDM 180 (el EDM 280 o el 1109 quedan fuera).
 */
export function modeloEdm180(modelo: unknown): string | null {
  const m = /^(?:GRIMM)?EDM180([A-Z]*)$/.exec(String(modelo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
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
export interface EquipoPortal { clave: string; serial: string; cliente: string; modelo: string; activo: boolean; deskId: string | null }

export const CAMPOS_MAESTRO = ['cliente', 'modelo', 'serial', 'activo'] as const;
export type CampoMaestro = (typeof CAMPOS_MAESTRO)[number];
/** Un cambio del plan, para revisar antes y para la auditoría después. Lleva cliente y serial. */
export interface CambioMaestro { clave: string; campo: CampoMaestro | 'alta'; antes: string | null; despues: string | null }

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
  /** Con el serial repetido en alguno de los dos lados: no se enlazan ni se tocan. */
  ambiguosMaestro: number;
  ambiguosPortal: number;
  /** Del maestro, sin serial o con uno más largo que la clave. */
  sinSerial: number;
  inactivos: number;
  /** A los que les cambia el cliente de verdad (por `claveCliente`), no sólo cómo se escribe. */
  cambianDeCliente: number;
  /** Contactos puestos a mano cuyo cliente tiene hoy algún equipo activo y dejaría de tenerlo. */
  contactosSinEquipos: number;
}

/** Lo que se escribe en un equipo que casa (todo sale del maestro menos la clave) y en un alta. */
export interface FilaEnlace { clave: string; deskId: string; serial: string; cliente: string; modelo: string; activo: boolean }
export type FilaAlta = Omit<FilaEnlace, 'activo'> & { marca: string };
export interface PlanMaestro { recuentos: RecuentosMaestro; enlaces: FilaEnlace[]; altas: FilaAlta[]; cambios: CambioMaestro[] }

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
export function planMaestro(maestro: readonly EquipoMaestro[], portal: readonly EquipoPortal[], contactos: readonly string[]): PlanMaestro {
  const m = maestro.filter((e) => esGrimmEdm180(e.marca, e.modelo)).sort((a, b) => a.id.localeCompare(b.id));
  const inventario = [...portal].sort((a, b) => a.clave.localeCompare(b.clave));
  const enMaestro = veces(m.map((e) => serialNorm(e.serial)));
  const enPortal = veces(inventario.map((p) => serialNorm(p.serial)));
  const porDeskId = new Map(inventario.filter((p) => p.deskId).map((p) => [p.deskId, p]));
  const r: RecuentosMaestro = {
    maestro: m.length, portal: inventario.length, casan: 0, enlaces: 0, cambios: { cliente: 0, modelo: 0, serial: 0, activo: 0 }, altas: 0,
    soloPortal: 0, soloPortalActivos: 0, ambiguosMaestro: 0, ambiguosPortal: 0, sinSerial: 0, inactivos: m.filter((e) => !e.activo).length, cambianDeCliente: 0, contactosSinEquipos: 0,
  };

  // 1. Por id de Desk 2.0. 2. Los demás, por serial; el repetido es ambiguo.
  const pares = new Map<string, EquipoMaestro>();
  const sueltos = m.filter((e) => {
    const p = porDeskId.get(e.id);
    if (p) pares.set(p.clave, e);
    return !p;
  });
  const libres = new Map(inventario.filter((p) => !pares.has(p.clave)).map((p) => [serialNorm(p.serial), p]));
  const nuevos: EquipoMaestro[] = [];
  for (const e of sueltos) {
    const s = serialNorm(e.serial);
    const p = libres.get(s);
    if (s === '' || s.length > CLAVE_MAX) r.sinSerial++;
    // También es ambiguo el que trae el serial de un equipo del portal ya enlazado con otro.
    else if (enMaestro.get(s)! > 1 || (enPortal.get(s) ?? 0) > 1 || (!p && enPortal.has(s))) r.ambiguosMaestro++;
    else if (p) pares.set(p.clave, e);
    else if (e.activo) nuevos.push(e);
  }

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
      if ((enPortal.get(s) ?? 0) > 1 || (enMaestro.get(s) ?? 0) > 1) r.ambiguosPortal++;
      else {
        r.soloPortal++;
        if (p.activo) r.soloPortalActivos++;
      }
      if (p.activo) despues.add(claveCliente(p.cliente));
      continue;
    }
    const serial = e.serial.trim();
    const fila: FilaEnlace = { clave: p.clave, deskId: e.id, serial: serial === '' || serial.length > CLAVE_MAX ? p.serial : serial, cliente: limpio(e.cliente).slice(0, CLIENTE_MAX) || p.cliente, modelo: modeloEdm180(e.modelo)!, activo: e.activo };
    enlaces.push(fila);
    r.casan++;
    if (p.deskId !== e.id) r.enlaces++;
    if (claveCliente(fila.cliente) !== claveCliente(p.cliente)) r.cambianDeCliente++;
    if (fila.activo) despues.add(claveCliente(fila.cliente));
    for (const campo of CAMPOS_MAESTRO) {
      if (fila[campo] === p[campo]) continue;
      r.cambios[campo]++;
      cambios.push({ clave: p.clave, campo, antes: texto(p[campo]), despues: texto(fila[campo]) });
    }
  }

  const claves = new Set(inventario.map((p) => p.clave));
  const altas = nuevos.map((e): FilaAlta => {
    const serial = e.serial.trim();
    const base = claveSerial(serial);
    let clave = base;
    for (let i = 2; claves.has(clave); i++) clave = `${base}-${i}`;
    claves.add(clave);
    const cliente = limpio(e.cliente).slice(0, CLIENTE_MAX) || SIN_CLIENTE;
    despues.add(claveCliente(cliente));
    cambios.push({ clave, campo: 'alta', antes: null, despues: `${serial} · ${cliente}` });
    return { clave, deskId: e.id, serial, cliente, marca: limpio(e.marca).slice(0, 60) || 'GRIMM', modelo: modeloEdm180(e.modelo)! };
  });
  r.altas = altas.length;
  r.contactosSinEquipos = contactos.filter((c) => antes.has(c) && !despues.has(c)).length;
  return { recuentos: r, enlaces, altas, cambios };
}

/** Si el maestro contestó en esta petición y, si no, por qué (un motivo de la lista, nunca el error). */
export interface EstadoMaestro { disponible: boolean; motivo: MotivoRespaldo | null; mensaje: string | null }
/** Una sincronización aplicada, de la auditoría (`portal.tmc_maestro_sincronizaciones`): sólo quién, cuándo y recuentos. */
export interface SincronizacionMaestro { id: number; huella: string; recuentos: RecuentosMaestro; por: string; en: string }

/** GET /trazabilidad/maestro/plan. `detalle` (con clientes y seriales, acotado) sólo va para quien puede sincronizar. */
export interface RespuestaPlanMaestro {
  maestro: EstadoMaestro;
  /** null sin maestro. `huella` identifica el plan: se manda al aplicarlo. */
  plan: { huella: string; recuentos: RecuentosMaestro } | null;
  ultima: SincronizacionMaestro | null;
  detalle?: CambioMaestro[];
  detalleTotal?: number;
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
