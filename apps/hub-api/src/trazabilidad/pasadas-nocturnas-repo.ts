/**
 * Pasadas nocturnas (lote 10, migración 062): el EJECUTOR. Para cada tipo, en
 * orden maestro → calibraciones y cada uno por su cuenta (si el maestro se
 * retiene o falla, las calibraciones siguen):
 *
 *   1. reclama el día en portal.tmc_pasadas_nocturnas con un INSERT … ON
 *      CONFLICT DO NOTHING: si no inserta, otra instancia (u otra pasada de
 *      hoy) ya lo hizo y aquí no se hace nada;
 *   2. lee el plan, el mismo de la tarjeta de Configuración, sin escribir;
 *      sin Desk 2.0, «no disponible»;
 *   3. decide (pasadas-nocturnas.ts): sin nada que escribir, «sin cambios»;
 *      si no es limpio, «retenida» con sus motivos;
 *   4. si es limpio, llama al aplicador de siempre (`sincronizarMaestro` /
 *      `sincronizarCalibraciones`) con la huella del plan evaluado y la firma
 *      «Pasada automática»: si entretanto el plan cambió, su 409 lo retiene;
 *   5. apunta cómo acabó.
 *
 * Sólo escribe su tabla. Los datos los cambian únicamente los dos aplicadores,
 * con sus bloqueos, su huella, su auditoría y su negativa a escribir sin Desk
 * 2.0. Nada de aquí envía nada a nadie. Cuándo se llama: programador-pasadas.ts.
 */
import type { Pool } from '@algarpibe/zoho-sync';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { getDesk2Pool } from '../db-desk2.js';
import { captureError } from '../sentry.js';
import { crearLectorCalibraciones, type LectorCalibraciones } from './calibraciones-desk2.js';
import { leerPlanCalibraciones, sincronizarCalibraciones } from './calibraciones-repo.js';
import { crearLectorMaestro, type LectorMaestro } from './maestro-desk2.js';
import { leerPlanMaestro, sincronizarMaestro } from './maestro-repo.js';
import { ACTOR_NOCTURNO, TIPOS_PASADA, decidirCalibraciones, decidirMaestro, type Decision, type PasadaNocturna, type ResultadoPasada, type TipoPasada } from './pasadas-nocturnas.js';
import { TzError } from './types.js';

/** Lo que lee un paso: o Desk 2.0 no contestó (y por qué), o el plan con su huella, sus recuentos y la decisión. */
export type LecturaPaso = { disponible: false; mensaje: string } | { disponible: true; huella: string; recuentos: unknown; decision: Decision };
/** Un tipo de pasada: leer su plan sin escribir, y aplicarlo con la huella de lo leído. */
export interface Paso {
  leer: (db: Pool) => Promise<LecturaPaso>;
  aplicar: (db: Pool, huella: string) => Promise<{ id: number }>;
}

/** Los dos pasos de verdad: los planes y los aplicadores de siempre, contra Desk 2.0 y a `hoy`. */
export function pasosDesk2(leerMaestro: LectorMaestro, leerCalibraciones: LectorCalibraciones, hoy: string): Record<TipoPasada, Paso> {
  return {
    maestro: {
      leer: async (db) => {
        const r = await leerPlanMaestro(db, leerMaestro, false);
        if (!r.plan) return { disponible: false, mensaje: r.maestro.mensaje ?? 'Desk 2.0 no contestó.' };
        return { disponible: true, huella: r.plan.huella, recuentos: { ...r.plan.recuentos, otras: r.plan.otras }, decision: decidirMaestro(r.plan.recuentos, r.plan.otras, r.ultima?.recuentos ?? null) };
      },
      aplicar: (db, huella) => sincronizarMaestro(db, leerMaestro, huella, ACTOR_NOCTURNO),
    },
    calibraciones: {
      leer: async (db) => {
        const r = await leerPlanCalibraciones(db, leerCalibraciones, hoy, false);
        if (!r.plan || !r.salud) return { disponible: false, mensaje: r.lectura.mensaje ?? 'Desk 2.0 no contestó.' };
        return { disponible: true, huella: r.plan.huella, recuentos: r.plan.recuentos, decision: decidirCalibraciones(r.plan.recuentos, r.salud) };
      },
      aplicar: (db, huella) => sincronizarCalibraciones(db, leerCalibraciones, huella, ACTOR_NOCTURNO, hoy),
    },
  };
}

interface Fin { resultado: Exclude<ResultadoPasada, 'en_curso'>; motivos: string[]; huella?: string; recuentos?: unknown; pasadaId?: number }

const MOTIVO_ERROR = 'La pasada falló: el detalle está en el registro del servidor.';
const MOTIVO_PLAN_CAMBIADO = 'El plan cambió entre leerlo y aplicarlo (algo cambió en Desk 2.0, o alguien lo aplicó a mano a la vez): no se aplicó nada.';

/** Un fallo inesperado: el error va al registro y a Sentry; al apunte, sólo que falló (un error de `pg` puede llevar host y usuario). */
function falla(tipo: TipoPasada, e: unknown): Fin {
  console.error(`tmc_pasada_nocturna_${tipo} error`, e);
  captureError(e, { endpoint: `tmc_pasada_nocturna_${tipo}` });
  return { resultado: 'error', motivos: [MOTIVO_ERROR] };
}

/** Pasos 2 a 4: nunca lanza. */
async function resolver(db: Pool, tipo: TipoPasada, paso: Paso): Promise<Fin> {
  let leido: LecturaPaso;
  try {
    leido = await paso.leer(db);
  } catch (e) {
    return falla(tipo, e);
  }
  if (!leido.disponible) return { resultado: 'no_disponible', motivos: [leido.mensaje] };
  const plan = { huella: leido.huella, recuentos: leido.recuentos };
  if (!leido.decision.escribe) return { ...plan, resultado: 'sin_cambios', motivos: [] };
  if (!leido.decision.limpio) return { ...plan, resultado: 'retenida', motivos: leido.decision.motivos };
  try {
    const aplicada = await paso.aplicar(db, leido.huella);
    return { ...plan, resultado: 'aplicada', motivos: [], pasadaId: aplicada.id };
  } catch (e) {
    if (e instanceof TzError && e.code === 'plan_cambiado') return { ...plan, resultado: 'retenida', motivos: [MOTIVO_PLAN_CAMBIADO] };
    if (e instanceof TzError && /_no_disponibles?$/.test(e.code)) return { ...plan, resultado: 'no_disponible', motivos: [e.messageEs] };
    if (e instanceof TzError && e.status === 409) return { ...plan, resultado: 'retenida', motivos: [e.messageEs] };
    return { ...plan, ...falla(tipo, e) };
  }
}

/** Un tipo entero. null = el día ya estaba reclamado (no se hizo nada). */
async function ejecutarUna(db: Pool, fecha: string, tipo: TipoPasada, paso: Paso): Promise<ResultadoPasada | null> {
  let id: number;
  try {
    const { rows } = await db.query(
      `INSERT INTO portal.tmc_pasadas_nocturnas (fecha, tipo, resultado) VALUES ($1, $2, 'en_curso')
       ON CONFLICT (fecha, tipo) DO NOTHING
       RETURNING id`,
      [fecha, tipo],
    );
    if (!rows[0]) return null;
    id = Number(rows[0].id);
  } catch (e) {
    return falla(tipo, e).resultado;
  }
  const fin = await resolver(db, tipo, paso);
  try {
    await db.query(
      `UPDATE portal.tmc_pasadas_nocturnas SET resultado = $2, motivos = $3::jsonb, huella = $4, recuentos = $5::jsonb, pasada_id = $6, termino = NOW() WHERE id = $1`,
      [id, fin.resultado, JSON.stringify(fin.motivos), fin.huella ?? null, fin.recuentos === undefined ? null : JSON.stringify(fin.recuentos), fin.pasadaId ?? null],
    );
  } catch (e) {
    falla(tipo, e); // el apunte se queda «en curso»: la tarjeta lo dice, y lo aplicado tiene su auditoría de siempre
  }
  console.log(`tmc_pasada_nocturna ${fecha} ${tipo}: ${fin.resultado}`);
  return fin.resultado;
}

/**
 * La pasada de esta noche, de los dos tipos. `hoy` (el día en Colombia) y
 * `pasos` son para las pruebas; por defecto, hoy y los lectores de Desk 2.0.
 * Nunca lanza: devuelve cómo acabó cada tipo.
 */
export async function ejecutarPasadasNocturnas(db: Pool, opts: { hoy?: string; pasos?: Record<TipoPasada, Paso> } = {}): Promise<Record<TipoPasada, ResultadoPasada | null>> {
  const hoy = opts.hoy ?? hoyEnColombia();
  const pasos = opts.pasos ?? pasosDesk2(crearLectorMaestro(getDesk2Pool), crearLectorCalibraciones(getDesk2Pool), hoy);
  const resultados = {} as Record<TipoPasada, ResultadoPasada | null>;
  for (const tipo of TIPOS_PASADA) resultados[tipo] = await ejecutarUna(db, hoy, tipo, pasos[tipo]);
  return resultados;
}

/** La última pasada nocturna de un tipo (para la tarjeta), o null si aún no ha salido ninguna. */
export async function ultimaNocturna(db: Pick<Pool, 'query'>, tipo: TipoPasada): Promise<PasadaNocturna | null> {
  const { rows } = await db.query(`SELECT fecha::text AS fecha, resultado, motivos, empezo::text AS empezo, termino::text AS termino FROM portal.tmc_pasadas_nocturnas WHERE tipo = $1 ORDER BY fecha DESC, id DESC LIMIT 1`, [tipo]);
  const r = rows[0];
  return r ? { fecha: r.fecha, resultado: r.resultado, motivos: r.motivos, empezo: r.empezo, termino: r.termino } : null;
}
