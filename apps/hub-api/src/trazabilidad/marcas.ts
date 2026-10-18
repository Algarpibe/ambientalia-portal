/**
 * Marcas en seguimiento (lote 9f, migración 061): la regla pura. Sin base,
 * sin reloj y sin más import que el dominio y tipos: la app lee de aquí los
 * tipos y la etiqueta de cada marca.
 *
 * Decisión de Alfonso (17/10/2026): las demás marcas entran en Resumen,
 * Equipos, Calendario y Avisos POR MARCA, con un interruptor por marca. GRIMM
 * EDM 180 está siempre incluido (su fila es fija: `en_seguimiento`, 058). El
 * interruptor de «grimm» es el de los GRIMM de OTROS modelos. Qué entra lo
 * decide `EN_INVENTARIO` (inventario.ts): esto sólo enseña y prepara.
 *
 * FECHAS COHERENTES DESDE EL PRIMER SEGUNDO: un equipo fuera del inventario
 * no tiene fila `fst022` de partida, y la pestaña le calcula la fecha con la
 * de la hoja más las calibraciones guardadas SIN CLAVE de su serial
 * (hoja.ts). Al incluir su marca, `planAdopcion` dice qué escribir para que
 * Equipos le dé esa MISMA fecha: su partida, guardada con su clave, y esas
 * calibraciones sueltas, enlazadas con él. Ninguna fecha cambia.
 *
 * VIGENCIA POR MARCA (lote 11, migración 063; decisión de Alfonso del
 * 18/10/2026), la regla en UN solo sitio (`vigenciaDeMarca`): GRIMM se calibra
 * cada 12 meses (365 días, como siempre). Horiba NO tiene plazo fijo: se
 * calibra con el preventivo, cuya frecuencia depende del contrato de cada
 * cliente (un dato que aún no existe: la frecuencia por contrato NO está
 * hecha). Así que Horiba y las demás empiezan SIN VENCIMIENTO: se ven con su
 * última calibración, pero no vencen, no avisan y no salen en el calendario.
 * Que una marca tenga plazo fijo se guarda por marca (`tmc_marcas_vigencia`);
 * sin fila manda `VIGENCIA_POR_DEFECTO`. GRIMM EDM 180 es fijo (365).
 */
import { ESTADOS, ESTADOS_AVISO, VIGENCIA_DIAS, claveCliente, type EstadoCalibracion } from './dominio.js';
import type { EquipoHoja, FilaHoja, TablaHoja } from './hoja.js';

/** La fila fija: los GRIMM EDM 180, siempre en seguimiento. No tiene interruptor (409 `marca_fija`) y su vigencia no se cambia. */
export const CLAVE_EDM180 = 'grimm edm 180';

/** La clave de una marca: la misma con que la pestaña agrupa las marcas («HORIBA» = « Horiba »). En SQL, `claveMarcaSql` (inventario.ts). */
export const claveMarca = (marca: unknown): string => claveCliente(marca);

/** El grupo de un equipo en esta tarjeta (y en la vigencia, lote 11): en seguimiento es GRIMM EDM 180; fuera, la clave de su marca. */
export const grupoMarca = (q: { enSeguimiento?: boolean; marca: string }): string => (q.enSeguimiento === false ? claveMarca(q.marca) : CLAVE_EDM180);

/** Lo que se puede guardar como vigencia: `null` (sin vencimiento) o un entero de días entre estos dos (de un mes a tres años). */
export const VIGENCIA_MIN_DIAS = 30;
export const VIGENCIA_MAX_DIAS = 1095;

/** Las marcas con plazo fijo mientras nadie guarde otro: GRIMM EDM 180 y los GRIMM de otros modelos. Las demás, sin vencimiento. */
export const VIGENCIA_POR_DEFECTO: Readonly<Record<string, number>> = { [CLAVE_EDM180]: VIGENCIA_DIAS, grimm: VIGENCIA_DIAS };

/** Lo guardado en `tmc_marcas_vigencia`: clave de la marca → días, o null (sin vencimiento). */
export type VigenciasGuardadas = ReadonlyMap<string, number | null>;

/** LA REGLA: la vigencia de la marca `clave` en días; null = sin vencimiento. Lo guardado manda; GRIMM EDM 180, siempre 365. */
export function vigenciaDeMarca(clave: string, guardadas: VigenciasGuardadas): number | null {
  if (clave === CLAVE_EDM180) return VIGENCIA_DIAS;
  if (guardadas.has(clave)) return guardadas.get(clave) ?? null;
  return VIGENCIA_POR_DEFECTO[clave] ?? null;
}

/** La vigencia de un equipo: la de su grupo (`grupoMarca`: en seguimiento, GRIMM EDM 180; fuera, su marca). */
export const vigenciaDeEquipo = (q: { enSeguimiento?: boolean; marca: string }, guardadas: VigenciasGuardadas): number | null => vigenciaDeMarca(grupoMarca(q), guardadas);

/** True si `v` se puede guardar como vigencia de una marca. */
export const esVigenciaValida = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= VIGENCIA_MIN_DIAS && v <= VIGENCIA_MAX_DIAS);

/** Cómo se enseña una marca: la fila fija, los GRIMM de otros modelos, y las demás con su forma más escrita. */
export function etiquetaMarca(clave: string, forma: string): string {
  if (clave === CLAVE_EDM180) return 'GRIMM EDM 180';
  return clave === 'grimm' ? `${forma} (otros modelos)` : forma;
}

/** Lo que pasaría al encender una marca (o lo que sale al apagarla). Sólo recuentos: ni clientes ni seriales. */
export interface ResumenMarca {
  /** Equipos activos y no retirados: los que entran (o salen) de Resumen, Equipos, Calendario y Avisos. */
  equipos: number;
  porEstado: Record<EstadoCalibracion, number>;
  /** De ellos, los que salen en «Avisos a clientes» (vencida o por vencer: `ESTADOS_AVISO`), y de cuántos clientes. +1 año y sin fecha no avisan. */
  avisos: number;
  clientesAvisos: number;
  /** Lo que se escribiría al encenderla: filas de partida que nacen y calibraciones sueltas que se enlazan con su equipo. */
  partidas: number;
  enlazadas: number;
  /** Lote 11: la última calibración de cada uno de esos equipos que la tiene (sólo fechas, ordenadas), para la vista previa de cambiar su vigencia. */
  fechas: string[];
}
export interface FirmaMarca { por: string; en: string; motivo: string }
export interface MarcaGuardada extends FirmaMarca { clave: string; marca: string; incluida: boolean }
/** Lo guardado en `portal.tmc_marcas_vigencia` (063): la vigencia de una marca, con su firma. `dias` null = sin vencimiento. */
export interface VigenciaGuardada extends FirmaMarca { clave: string; marca: string; dias: number | null }
/** La vigencia de una marca (lote 11): sus días (null = sin vencimiento), si es la fija (GRIMM EDM 180), si sale del código (nadie la ha cambiado) y su firma. */
export interface VigenciaMarca { dias: number | null; fija: boolean; porDefecto: boolean; firma: FirmaMarca | null }
export interface MarcaSeguimiento { clave: string; marca: string; fija: boolean; incluida: boolean; firma: FirmaMarca | null; vigencia: VigenciaMarca; resumen: ResumenMarca }
/** Un apunte de `portal.tmc_marcas_cambios`. */
export interface CambioMarca extends FirmaMarca { id: number; clave: string; marca: string; accion: 'incluir' | 'excluir'; equipos: number; partidas: number; enlazadas: number }
/** Un apunte de `portal.tmc_marcas_vigencia_cambios` (063): la vigencia de antes y la nueva (null = sin vencimiento). */
export interface CambioVigencia extends FirmaMarca { id: number; clave: string; marca: string; antes: number | null; despues: number | null }
/** GET /trazabilidad/marcas: cada marca con su vista previa y su vigencia, y los últimos cambios de las dos cosas. */
export interface RespuestaMarcas { hoy: string; marcas: MarcaSeguimiento[]; cambios: CambioMarca[]; cambiosVigencia: CambioVigencia[] }

/** Una partida que nace al incluir: la fecha de la hoja de la fila `fila`, con su estado (una fecha futura o absurda, en revisión, como en la pestaña). */
export interface PartidaNueva { clave: string; serial: string; fecha: string; estado: 'vigente' | 'en_revision'; fila: number }
export interface Adopcion { partidas: PartidaNueva[]; enlazar: { id: number; clave: string }[] }

/**
 * Qué escribir para incluir los equipos `objetivo` (sus claves), leído de la tabla de la pestaña calculada con ellos FUERA del
 * inventario: la partida que su fila toma de la hoja (id negativo) se guarda con su clave, y las calibraciones guardadas sin clave
 * (`sinClave`, sus ids) que la pestaña le atribuye por serial —de Desk, manuales, también anuladas— se enlazan con él. Así su fecha
 * en Equipos es la que ya daba la pestaña. Lo ya guardado con su clave no se toca: con todo aplicado, no trae nada (idempotente).
 */
export function planAdopcion(tabla: TablaHoja, objetivo: ReadonlySet<string>, sinClave: ReadonlySet<number>): Adopcion {
  const a: Adopcion = { partidas: [], enlazar: [] };
  for (const f of [...tabla.filas, ...tabla.fueraDeHoja]) {
    if (f.clave === null || !objetivo.has(f.clave)) continue;
    for (const c of f.calibraciones) {
      if (c.id < 0) a.partidas.push({ clave: f.clave, serial: f.serial, fecha: c.fecha, estado: c.estado === 'en_revision' ? 'en_revision' : 'vigente', fila: -c.id });
      else if (sinClave.has(c.id)) a.enlazar.push({ id: c.id, clave: f.clave });
    }
  }
  return a;
}

export interface EntradaMarcas { tabla: TablaHoja; equipos: readonly EquipoHoja[]; guardadas: readonly MarcaGuardada[]; sinClave: ReadonlySet<number>; vigencias: readonly VigenciaGuardada[] }

/**
 * Una fila por marca, con su vista previa: GRIMM EDM 180 (fija), las incluidas y después las demás, de más a menos equipos. Una marca
 * sale si tiene algún equipo fuera de seguimiento o si está guardada (para poder apagarla aunque ya no tenga equipos). Un equipo sin
 * marca no tiene interruptor.
 */
export function marcasEnSeguimiento(e: EntradaMarcas): MarcaSeguimiento[] {
  const grupoDe = grupoMarca;
  const deEquipo = new Map(e.equipos.map((q) => [q.clave, q]));
  const filaDe = new Map<string, FilaHoja>();
  for (const f of [...e.tabla.filas, ...e.tabla.fueraDeHoja]) if (f.clave !== null) filaDe.set(f.clave, f);
  const guardada = new Map(e.guardadas.map((g) => [g.clave, g]));
  const vigente = new Map(e.vigencias.map((v) => [v.clave, v]));
  const dias = new Map(e.vigencias.map((v) => [v.clave, v.dias]));
  const claves = [...new Set([CLAVE_EDM180, ...e.equipos.map(grupoDe), ...guardada.keys(), ...vigente.keys()])].filter((k) => k !== '');

  const marcas = claves.map((clave): MarcaSeguimiento => {
    const suyos = e.equipos.filter((q) => grupoDe(q) === clave);
    const vivos = suyos.filter((q) => q.activo && !q.retirado).map((q) => filaDe.get(q.clave)).filter((f): f is FilaHoja => f !== undefined);
    const enAvisos = vivos.filter((f) => ESTADOS_AVISO.includes(f.estado));
    const adopcion = clave === CLAVE_EDM180 ? { partidas: [], enlazar: [] } : planAdopcion(e.tabla, new Set(suyos.map((q) => q.clave)), e.sinClave);
    const veces = new Map<string, number>();
    for (const q of suyos) veces.set(q.marca.trim(), (veces.get(q.marca.trim()) ?? 0) + 1);
    const forma = [...veces].reduce<[string, number] | null>((a, b) => (!a || b[1] > a[1] ? b : a), null)?.[0] ?? guardada.get(clave)?.marca ?? clave;
    const g = guardada.get(clave);
    const v = clave === CLAVE_EDM180 ? undefined : vigente.get(clave);
    return {
      clave, marca: etiquetaMarca(clave, forma), fija: clave === CLAVE_EDM180, incluida: clave === CLAVE_EDM180 || (g?.incluida ?? false), firma: g ? { por: g.por, en: g.en, motivo: g.motivo } : null,
      vigencia: { dias: vigenciaDeMarca(clave, dias), fija: clave === CLAVE_EDM180, porDefecto: !v, firma: v ? { por: v.por, en: v.en, motivo: v.motivo } : null },
      resumen: {
        equipos: vivos.length,
        porEstado: Object.fromEntries(ESTADOS.map((s) => [s, vivos.filter((f) => f.estado === s).length])) as Record<EstadoCalibracion, number>,
        avisos: enAvisos.length,
        clientesAvisos: new Set(enAvisos.map((f) => claveCliente(deEquipo.get(f.clave!)?.cliente ?? f.cliente))).size,
        partidas: adopcion.partidas.length,
        enlazadas: adopcion.enlazar.length,
        fechas: vivos.flatMap((f) => (f.ultimaCalibracion ? [f.ultimaCalibracion] : [])).sort(),
      },
    };
  });
  return marcas.sort((a, b) => Number(b.fija) - Number(a.fija) || Number(b.incluida) - Number(a.incluida) || b.resumen.equipos - a.resumen.equipos || a.clave.localeCompare(b.clave));
}
