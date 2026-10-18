import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { ejecutarPasadasNocturnas, ultimaNocturna, type Paso } from './pasadas-nocturnas-repo.js';
import { TzError } from './types.js';

// Las pasadas nocturnas (lote 10): el EJECUTOR sin base. La base es un doble que apunta lo que se le pide y los
// pasos (leer el plan, aplicarlo) son dobles: aquí se prueba qué resultado queda apuntado en cada caso y que un
// tipo no arrastra al otro. Con Postgres de verdad y los aplicadores de verdad: pasadas-nocturnas.db.test.ts.

const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const HOY = '2026-10-19';

interface Consulta { sql: string; params: unknown[] }
let consultas: Consulta[] = [];
/** Tipos que «otra instancia» ya reclamó hoy: su INSERT no devuelve fila. */
let reclamados = new Set<string>();
let siguienteId = 1;
const db = {
  query: async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql, params });
    if (/^INSERT INTO portal\.tmc_pasadas_nocturnas/.test(sql)) return reclamados.has(String(params[1])) ? { rows: [], rowCount: 0 } : { rows: [{ id: siguienteId++ }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  },
} as unknown as Pool;

/** Lo que quedó apuntado al cerrar cada tipo: [id, resultado, motivos, huella, recuentos, pasada_id]. */
const cierres = () => consultas.filter((c) => /^UPDATE portal\.tmc_pasadas_nocturnas/.test(c.sql)).map((c) => [c.params[0], c.params[1], JSON.parse(String(c.params[2])), c.params[3], c.params[4] === null ? null : JSON.parse(String(c.params[4])), c.params[5]]);

const HUELLA = 'ab'.repeat(32);
/** Un paso de mentira: lo que lee y lo que hace al aplicar. */
function paso(leido: Awaited<ReturnType<Paso['leer']>> | Error, aplicar: (() => Promise<{ id: number }>) | null = null) {
  return {
    leer: vi.fn(async () => (leido instanceof Error ? Promise.reject(leido) : leido)),
    aplicar: vi.fn(async (_db: Pool, _huella: string) => (aplicar ? aplicar() : { id: 77 })),
  };
}
const limpio = (recuentos: object = { nuevas: 2 }) => ({ disponible: true as const, huella: HUELLA, recuentos, decision: { escribe: true, limpio: true, motivos: [] } });
const retenido = (motivos: string[]) => ({ disponible: true as const, huella: HUELLA, recuentos: { altas: 1 }, decision: { escribe: true, limpio: false, motivos } });
const sinCambios = { disponible: true as const, huella: HUELLA, recuentos: { altas: 0 }, decision: { escribe: false, limpio: true, motivos: [] } };

let error: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consultas = [];
  reclamados = new Set();
  siguienteId = 1;
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  error.mockRestore();
  log.mockRestore();
});

describe('el ejecutor', () => {
  it('reclama el día de cada tipo, en orden maestro → calibraciones, con la fecha de Colombia', async () => {
    const maestro = paso(sinCambios);
    const calibraciones = paso(sinCambios);
    expect(await ejecutarPasadasNocturnas(db, { hoy: HOY, pasos: { maestro, calibraciones } })).toEqual({ maestro: 'sin_cambios', calibraciones: 'sin_cambios' });
    const inserts = consultas.filter((c) => c.sql.startsWith('INSERT'));
    expect(inserts.map((c) => c.params)).toEqual([[HOY, 'maestro'], [HOY, 'calibraciones']]);
    expect(inserts[0].sql).toMatch(/VALUES \(\$1, \$2, 'en_curso'\)\s+ON CONFLICT \(fecha, tipo\) DO NOTHING\s+RETURNING id/);
  });

  it('limpio: aplica con la huella del plan evaluado y apunta «aplicada» con el id de su auditoría', async () => {
    const maestro = paso(limpio({ enlaces: 1 }), async () => ({ id: 41 }));
    const calibraciones = paso(limpio(), async () => ({ id: 42 }));
    expect(await ejecutarPasadasNocturnas(db, { hoy: HOY, pasos: { maestro, calibraciones } })).toEqual({ maestro: 'aplicada', calibraciones: 'aplicada' });
    expect(maestro.aplicar).toHaveBeenCalledWith(db, HUELLA);
    expect(calibraciones.aplicar).toHaveBeenCalledWith(db, HUELLA);
    expect(cierres()).toEqual([[1, 'aplicada', [], HUELLA, { enlaces: 1 }, 41], [2, 'aplicada', [], HUELLA, { nuevas: 2 }, 42]]);
  });

  it('sin nada que escribir: «sin cambios», y el aplicador NO se llama', async () => {
    const maestro = paso(sinCambios);
    await ejecutarPasadasNocturnas(db, { hoy: HOY, pasos: { maestro, calibraciones: paso(sinCambios) } });
    expect(maestro.aplicar).not.toHaveBeenCalled();
    expect(cierres()[0]).toEqual([1, 'sin_cambios', [], HUELLA, { altas: 0 }, null]);
  });

  it('retenida: no aplica y apunta sus motivos', async () => {
    const maestro = paso(retenido(['Equipos nuevos que se darían de alta (GRIMM EDM 180): 1']));
    await ejecutarPasadasNocturnas(db, { hoy: HOY, pasos: { maestro, calibraciones: paso(sinCambios) } });
    expect(maestro.aplicar).not.toHaveBeenCalled();
    expect(cierres()[0]).toEqual([1, 'retenida', ['Equipos nuevos que se darían de alta (GRIMM EDM 180): 1'], HUELLA, { altas: 1 }, null]);
  });

  it('Desk 2.0 no contesta: «no disponible» con el motivo, sin huella ni recuentos', async () => {
    const maestro = paso({ disponible: false, mensaje: 'Desk 2.0 no contesta.' });
    await ejecutarPasadasNocturnas(db, { hoy: HOY, pasos: { maestro, calibraciones: paso(sinCambios) } });
    expect(cierres()[0]).toEqual([1, 'no_disponible', ['Desk 2.0 no contesta.'], null, null, null]);
  });

  it('el plan cambió entre leerlo y aplicarlo (409 plan_cambiado): «retenida», con su porqué', async () => {
    const maestro = paso(limpio(), () => Promise.reject(new TzError('plan_cambiado', 409, 'El plan ha cambiado…')));
    await ejecutarPasadasNocturnas(db, { hoy: HOY, pasos: { maestro, calibraciones: paso(sinCambios) } });
    expect(cierres()[0].slice(1, 3)).toEqual(['retenida', ['El plan cambió entre leerlo y aplicarlo (algo cambió en Desk 2.0, o alguien lo aplicó a mano a la vez): no se aplicó nada.']]);
  });

  it('Desk 2.0 deja de contestar al aplicar (409 *_no_disponible[s]): «no disponible»; otro 409 (lectura sospechosa): «retenida» con su mensaje', async () => {
    const maestro = paso(limpio(), () => Promise.reject(new TzError('maestro_no_disponible', 409, 'Desk 2.0 no contesta. No se ha sincronizado nada.')));
    const calibraciones = paso(limpio(), () => Promise.reject(new TzError('lectura_sospechosa', 409, 'Ningún ticket trae la fecha.')));
    expect(await ejecutarPasadasNocturnas(db, { hoy: HOY, pasos: { maestro, calibraciones } })).toEqual({ maestro: 'no_disponible', calibraciones: 'retenida' });
    expect(cierres().map((c) => c.slice(1, 3))).toEqual([['no_disponible', ['Desk 2.0 no contesta. No se ha sincronizado nada.']], ['retenida', ['Ningún ticket trae la fecha.']]]);
  });

  it('un fallo inesperado (al leer o al aplicar) es «error», con un motivo que no lleva el error (va al registro); y el otro tipo sigue', async () => {
    const maestro = paso(new Error('connect ECONNREFUSED postgres://usuario:clave@host/base'));
    const calibraciones = paso(limpio(), async () => ({ id: 9 }));
    expect(await ejecutarPasadasNocturnas(db, { hoy: HOY, pasos: { maestro, calibraciones } })).toEqual({ maestro: 'error', calibraciones: 'aplicada' });
    expect(cierres()[0].slice(1, 3)).toEqual(['error', ['La pasada falló: el detalle está en el registro del servidor.']]);
    expect(JSON.stringify(cierres())).not.toMatch(/postgres:|ECONNREFUSED|clave@/);
    expect(error).toHaveBeenCalled();
    const otro = paso(limpio(), () => Promise.reject(new Error('fallo de la base')));
    consultas = [];
    expect(await ejecutarPasadasNocturnas(db, { hoy: HOY, pasos: { maestro: otro, calibraciones: paso(sinCambios) } })).toEqual({ maestro: 'error', calibraciones: 'sin_cambios' });
  });

  it('INDEPENDIENTES: si el maestro se retiene, las calibraciones se aplican igual', async () => {
    const calibraciones = paso(limpio(), async () => ({ id: 5 }));
    expect(await ejecutarPasadasNocturnas(db, { hoy: HOY, pasos: { maestro: paso(retenido(['x: 1'])), calibraciones } })).toEqual({ maestro: 'retenida', calibraciones: 'aplicada' });
  });

  it('un día ya reclamado (otra instancia, o una pasada de antes) no hace NADA: ni lee el plan ni apunta', async () => {
    reclamados = new Set(['maestro']);
    const maestro = paso(limpio());
    const calibraciones = paso(sinCambios);
    expect(await ejecutarPasadasNocturnas(db, { hoy: HOY, pasos: { maestro, calibraciones } })).toEqual({ maestro: null, calibraciones: 'sin_cambios' });
    expect(maestro.leer).not.toHaveBeenCalled();
    expect(maestro.aplicar).not.toHaveBeenCalled();
    expect(cierres()).toHaveLength(1);
  });

  it('si reclamar falla (la base del portal caída), ese tipo no hace nada, se apunta en el registro y el otro lo intenta', async () => {
    const rota = { query: async (sql: string, params: unknown[] = []) => (params[1] === 'maestro' && sql.startsWith('INSERT') ? Promise.reject(new Error('sin base')) : db.query(sql, params)) } as unknown as Pool;
    const maestro = paso(limpio());
    expect(await ejecutarPasadasNocturnas(rota, { hoy: HOY, pasos: { maestro, calibraciones: paso(sinCambios) } })).toEqual({ maestro: 'error', calibraciones: 'sin_cambios' });
    expect(maestro.leer).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});

describe('la última pasada nocturna de un tipo (para las tarjetas)', () => {
  it('la más reciente de ese tipo, con sus motivos; null si no hay ninguna', async () => {
    expect(await ultimaNocturna(db, 'maestro')).toBeNull();
    expect(consultas[0].sql).toMatch(/FROM portal\.tmc_pasadas_nocturnas WHERE tipo = \$1 ORDER BY fecha DESC, id DESC LIMIT 1/);
    expect(consultas[0].params).toEqual(['maestro']);
    const conFila = { query: async () => ({ rows: [{ fecha: HOY, resultado: 'retenida', motivos: ['x: 1'], empezo: '2026-10-19 07:00:00+00', termino: '2026-10-19 07:00:03+00' }] }) } as unknown as Pool;
    expect(await ultimaNocturna(conFila, 'calibraciones')).toEqual({ fecha: HOY, resultado: 'retenida', motivos: ['x: 1'], empezo: '2026-10-19 07:00:00+00', termino: '2026-10-19 07:00:03+00' });
  });
});

describe('062_trazabilidad_pasadas_nocturnas.sql', () => {
  const sinComentarios = fuente('../users/migrations/062_trazabilidad_pasadas_nocturnas.sql').replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('sólo crea su tabla con IF NOT EXISTS: sin semilla, sin clave foránea y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias.map((s) => /^CREATE (?:SCHEMA|TABLE) IF NOT EXISTS (portal(?:\.\w+)?)/.exec(s)?.[1])).toEqual(['portal', 'portal.tmc_pasadas_nocturnas']);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|SELECT|TRIGGER)\b/i);
    expect(sinComentarios).not.toMatch(/\bREFERENCES\b|\bdesk\.|tmc_equipos/i);
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|destinatari|email|correo/i);
  });

  it('un día y un tipo, una fila: UNIQUE (fecha, tipo); sus valores cerrados; en curso si y sólo si no ha terminado', () => {
    expect(sinComentarios).toMatch(/fecha\s+DATE\s+NOT NULL/);
    expect(sinComentarios).toMatch(/CONSTRAINT tmc_pasadas_nocturnas_dia_uq UNIQUE \(fecha, tipo\)/);
    expect(sinComentarios).toMatch(/CHECK \(tipo IN \('maestro', 'calibraciones'\)\)/);
    expect(sinComentarios).toMatch(/CHECK \(resultado IN \('en_curso', 'aplicada', 'sin_cambios', 'retenida', 'no_disponible', 'error'\)\)/);
    expect(sinComentarios).toMatch(/CONSTRAINT tmc_pasadas_nocturnas_termino CHECK \(\(resultado = 'en_curso'\) = \(termino IS NULL\)\)/);
    expect(sinComentarios).toMatch(/motivos\s+JSONB\s+NOT NULL DEFAULT '\[\]'::jsonb CHECK \(jsonb_typeof\(motivos\) = 'array'\)/);
    expect(sinComentarios).toMatch(/pasada_id\s+BIGINT\s+NULL/);
    expect(sinComentarios).not.toMatch(/cliente|\bserial\b/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 061, y es la última', () => {
    expect(fuente('../db.ts')).toMatch(/'061_trazabilidad_marcas_seguimiento\.sql',\s*'062_trazabilidad_pasadas_nocturnas\.sql'\]/);
  });
});

// CANDADO del lote 10. Hasta aquí, sincronizar el maestro y traer las calibraciones eran SIEMPRE a mano. Ahora una
// pasada nocturna puede aplicarlos sola, y por eso se vigila con lupa qué pueden hacer los tres ficheros nuevos:
//   · escribir, sólo su tabla (`tmc_pasadas_nocturnas`, el apunte de cada noche);
//   · cambiar datos, SÓLO a través de los dos aplicadores de siempre (`sincronizarMaestro`, `sincronizarCalibraciones`),
//     con sus bloqueos, su huella, su auditoría y su 409 sin Desk 2.0: nada de escribir el inventario o las fechas a pelo;
//   · enviar, NADA: ni correo, ni n8n, ni webhook, ni un fetch. Los avisos siguen siendo manuales o simulados.
// Los candados «no hay programador» de maestro*.ts, calibraciones*.ts, edicion-repo.ts y marcas*.ts siguen en pie: el
// programador vive en su fichero y esos ficheros no saben que existe.
describe('CANDADO: qué pueden hacer las pasadas nocturnas', () => {
  // El programador (programador-pasadas.ts) tiene su parte de este candado en programador-pasadas.test.ts.
  const NUEVOS = ['./pasadas-nocturnas.ts', './pasadas-nocturnas-repo.ts'];

  it('sólo escriben su tabla, y nunca nombran el inventario', () => {
    for (const f of NUEVOS) {
      const src = fuente(f);
      const escrituras = [...src.matchAll(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+([a-z_.0-9]+)/g)].map((m) => m[2]);
      for (const t of escrituras) expect(t, f).toBe('portal.tmc_pasadas_nocturnas');
      expect(src, f).not.toMatch(/tmc_equipos|tmc_calibraciones\b|en_seguimiento|tmc_fst022|tmc_seguimiento|tmc_contactos|tmc_marcas/);
    }
    expect([...fuente('./pasadas-nocturnas-repo.ts').matchAll(/(INSERT\s+INTO|UPDATE)\s+portal\.tmc_pasadas_nocturnas/g)]).toHaveLength(2);
  });

  it('sólo cambian datos llamando a los aplicadores de siempre: del resto del módulo no importan nada que escriba', () => {
    const imports = [...fuente('./pasadas-nocturnas-repo.ts').matchAll(/^import (?:type )?\{([^}]*)\} from '\.\/([\w-]+)\.js';\r?$/gm)].map((m) => [m[2], m[1].split(',').map((s) => s.trim().replace(/^type /, '')).filter(Boolean).sort()]);
    expect(Object.fromEntries(imports)).toEqual({
      'calibraciones-desk2': ['LectorCalibraciones', 'crearLectorCalibraciones'],
      'calibraciones-repo': ['leerPlanCalibraciones', 'sincronizarCalibraciones'],
      'maestro-desk2': ['LectorMaestro', 'crearLectorMaestro'],
      'maestro-repo': ['leerPlanMaestro', 'sincronizarMaestro'],
      'pasadas-nocturnas': ['ACTOR_NOCTURNO', 'Decision', 'PasadaNocturna', 'ResultadoPasada', 'TIPOS_PASADA', 'TipoPasada', 'decidirCalibraciones', 'decidirMaestro'],
      types: ['TzError'],
    });
  });

  it('fuera de las rutas, sólo el ejecutor nocturno llama a los aplicadores', () => {
    const RAIZ = fileURLToPath(new URL('..', import.meta.url));
    const fuentes = (readdirSync(RAIZ, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('test-db/'));
    const llaman = fuentes.filter((f) => /\b(sincronizarMaestro|sincronizarCalibraciones)\(/.test(readFileSync(`${RAIZ}/${f}`, 'utf8')));
    expect(llaman.sort()).toEqual(['trazabilidad/calibraciones-repo.ts', 'trazabilidad/maestro-repo.ts', 'trazabilidad/pasadas-nocturnas-repo.ts', 'trazabilidad/router.ts']);
  });

  it('NADA de esto envía nada a nadie, ni tiene temporizadores (el cuándo es sólo del programador)', () => {
    for (const f of NUEVOS) expect(fuente(f), f).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox|correo|destinatari|\benviar\b|planAvisos|mensajeAviso|setInterval|setTimeout/i);
  });
});
