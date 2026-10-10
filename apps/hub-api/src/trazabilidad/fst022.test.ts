import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serialNorm } from './dominio.js';
import { PROBLEMAS_FST022 } from './fst022.js';
import { MOTIVO_MAX, TzError, parsePaginaFst022 } from './types.js';

// La congelación de la F-ST-022, sin base. La hoja se congeló en el lote 9a y
// el 10/10/2026 se retiró toda subida de Excel: aquí queda lo que sigue vivo
// (leerla), las guardas de la migración 055 y la de que NINGÚN fuente escribe
// ya en sus tablas. Las reglas con que se preparó la hoja (cabecera, filas de
// equipo, recuentos) y su validador se borraron con la subida: están en el
// historial de git (233c340).

const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('lo que se lee de la congelación', () => {
  it('serial_norm es el serial como lo cruza el portal con Desk: mayúsculas y sin espacios alrededor', () => {
    expect(serialNorm(' 18a00001 ')).toBe('18A00001');
    expect(serialNorm(null)).toBe('');
  });

  it('los tipos de problema guardados en `problemas` siguen siendo los siete de la 055 (son claves de un dato ya guardado: no se renombran)', () => {
    expect([...PROBLEMAS_FST022]).toEqual(['sin_serial', 'sin_cliente', 'serial_repetido', 'serial_cientifico', 'error_excel', 'texto_en_fecha', 'fecha_imposible']);
  });

  it('la página de la vigente: desde 0 y 500 filas por defecto, con tope', () => {
    expect(parsePaginaFst022({})).toEqual({ desde: 0, limite: 500 });
    expect(parsePaginaFst022({ desde: '120', limite: '1000' })).toEqual({ desde: 120, limite: 1000 });
    for (const q of [{ desde: '-1' }, { desde: 'a' }, { limite: '0' }, { limite: '1001' }, { limite: ['1'] }]) expect(() => parsePaginaFst022(q)).toThrow(TzError);
  });
});

describe('055_trazabilidad_fst022_congelacion.sql', () => {
  const SQL = fuente('../users/migrations/055_trazabilidad_fst022_congelacion.sql');
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('sólo crea con IF NOT EXISTS, sin semilla y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias).toHaveLength(5);
    for (const s of sentencias) expect(s).toMatch(/^CREATE (SCHEMA|TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS /);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|SELECT|TRIGGER)\b/i);
    expect(SQL).not.toMatch(/\bdesk\./);
  });

  it('como mucho una congelación vigente, y las filas con clave (congelación, fila)', () => {
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS tmc_fst022_congelaciones_vigente_uq ON portal\.tmc_fst022_congelaciones \(vigente\) WHERE vigente/);
    expect(sinComentarios).toMatch(/PRIMARY KEY \(congelacion_id, fila\)/);
    expect(sinComentarios).toMatch(new RegExp(`motivo\\s+VARCHAR\\(${MOTIVO_MAX}\\)`));
  });

  it('está apuntada en MIGRATIONS, detrás de la 054, y es la última: retirar la subida no trae migración ni borra nada', () => {
    expect(fuente('../db.ts')).toMatch(/'054_trazabilidad_agenda_historial\.sql',\s*'055_trazabilidad_fst022_congelacion\.sql'\]/);
  });
});

describe('la congelación ya no se escribe: ni sus filas ni su cabecera', () => {
  it('ningún fuente del módulo inserta, cambia ni borra nada en las tablas tmc_fst022_*: sólo se leen', () => {
    for (const f of ['./repo.ts', './router.ts', './types.ts', './fst022.ts', './registro-estados.ts']) {
      expect(fuente(f)).not.toMatch(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)[^;`]*tmc_fst022_\w+/i);
    }
    expect(fuente('./repo.ts')).toMatch(/FROM portal\.tmc_fst022_congelada/);
  });
});
