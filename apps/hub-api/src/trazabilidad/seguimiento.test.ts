import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// «En seguimiento» (lote 9d-2a, migración 058), sin base: las guardas de la 058
// y el CANDADO de quién lee `portal.tmc_equipos`. Desde este lote la tabla
// lleva también equipos de otras marcas, enlazados con Desk 2.0 pero FUERA de
// seguimiento: no pueden asomar en Resumen, Equipos, Calendario, Avisos (ni su
// simulación), contactos ni Servicios. Lo que prueba que no asoman, con datos,
// es seguimiento.db.test.ts; esto vigila que nadie añada un lector sin revisar.

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('058_trazabilidad_en_seguimiento.sql', () => {
  const sinComentarios = fuente('../users/migrations/058_trazabilidad_en_seguimiento.sql').replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('sólo añade la columna, con IF NOT EXISTS: lo que ya había queda en seguimiento, sin semilla y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias).toEqual(['ALTER TABLE portal.tmc_equipos ADD COLUMN IF NOT EXISTS en_seguimiento BOOLEAN NOT NULL DEFAULT TRUE']);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|SELECT|TRIGGER)\b/i);
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|cola|programad/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 057 (la última es la 060: exportacion.test.ts)', () => {
    expect(fuente('../db.ts')).toMatch(/'057_trazabilidad_calibraciones\.sql',\s*'058_trazabilidad_en_seguimiento\.sql',/);
  });
});

describe('CANDADO: quién lee portal.tmc_equipos', () => {
  /** Todos los fuentes de hub-api que no son pruebas, con su ruta desde `src/`. */
  const fuentes = (readdirSync(RAIZ, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('test-db/'));
  const usos = fuentes.flatMap((f) => [...readFileSync(`${RAIZ}/${f}`, 'utf8').matchAll(/\b(FROM|JOIN|UPDATE|INSERT INTO)\s+portal\.tmc_equipos\b([^`]*)/g)].map((m) => ({ donde: `${f} · ${m[1]}`, resto: m[2] })));

  // La lista REVISADA. Añadir un lector aquí es decidir si ve sólo lo que está en seguimiento.
  const REVISADOS: Record<string, 'filtra' | 'todos'> = {
    // El inventario de la app: el único sitio de repo.ts que nombra la tabla (`INVENTARIO`). De él beben GET /equipos
    // (y con él Resumen, Equipos, Calendario, Avisos y su simulación), los contactos de Desk, el cliente de
    // «Servicios», guardar el seguimiento y marcar avisos en bloque.
    'trazabilidad/repo.ts · FROM': 'filtra',
    // La pasada de calibraciones: las otras marcas siguen con sus calibraciones por serial, sin clave.
    'trazabilidad/calibraciones-repo.ts · FROM': 'filtra',
    // El maestro tiene que ver los dos ámbitos para no dar de alta dos veces, y es el único que escribe.
    'trazabilidad/maestro-repo.ts · FROM': 'todos',
    'trazabilidad/maestro-repo.ts · UPDATE': 'todos',
    'trazabilidad/maestro-repo.ts · INSERT INTO': 'todos',
    // La pestaña «Trazabilidad F-ST-022» enseña la hoja entera: es la que distingue «fuera de seguimiento».
    'trazabilidad/hoja-repo.ts · FROM': 'todos',
    // AMPLIADA en el lote 9d-2b: retirar y reincorporar un equipo A MANO. Es la segunda escritura de la tabla y está justificada:
    // la hace una persona con `inventario.write`, con motivo y firma, y sólo cambia `activo` y la marca de retirado (retiros.test.ts
    // lo vigila: ni cliente, ni serial, ni `en_seguimiento`). Ve los dos ámbitos porque también se retira un equipo enlazado fuera
    // de seguimiento; no alimenta Resumen, Equipos ni Avisos: ésos siguen leyendo de `INVENTARIO`, que ya deja fuera lo inactivo.
    'trazabilidad/retiros-repo.ts · FROM': 'todos',
    'trazabilidad/retiros-repo.ts · UPDATE': 'todos',
  };

  it('sólo la nombran los sitios revisados, una vez cada uno', () => {
    expect(usos.map((u) => u.donde).sort()).toEqual(Object.keys(REVISADOS).sort());
  });

  it('los que alimentan la app piden sólo lo que está en seguimiento, en la misma consulta', () => {
    for (const u of usos) if (REVISADOS[u.donde] === 'filtra') expect(u.resto, u.donde).toMatch(/^\s+WHERE en_seguimiento\b/);
  });

  it('en repo.ts todo pasa por `INVENTARIO`: cinco lecturas y ninguna tabla a pelo', () => {
    const src = fuente('./repo.ts');
    expect(src).toMatch(/const INVENTARIO = `\(SELECT \* FROM portal\.tmc_equipos WHERE en_seguimiento\)`/);
    expect(src.match(/\$\{INVENTARIO\} e\b/g)).toHaveLength(5);
    for (const f of ['consultarEquipos', 'contactosDeDesk', 'listarServicios', 'existeActivo', 'registrarAvisos']) {
      const cuerpo = src.slice(src.indexOf(`function ${f}(`));
      expect(cuerpo.slice(0, cuerpo.search(/\r?\n}\r?\n/)), f).toContain('${INVENTARIO} e');
    }
  });

  it('nadie cambia `en_seguimiento` de una fila que ya existe: sincronizar sólo lo pone al dar de alta', () => {
    for (const f of fuentes) expect(readFileSync(`${RAIZ}/${f}`, 'utf8'), f).not.toMatch(/en_seguimiento\s*=/);
  });
});
