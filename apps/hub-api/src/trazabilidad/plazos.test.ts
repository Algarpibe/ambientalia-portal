import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { claveTipoServicio } from './dominio.js';
import { calcularPlazo, diasHabilesEntre, festivosDelEje, sumarDiasHabiles } from './plazos.js';

// Calendario de referencia (octubre de 2026): el lunes 5 es hábil, el lunes 12
// es festivo (Día de la Raza) y el 1 de enero de 2027 cae en viernes.

describe('sumarDiasHabiles', () => {
  it('el día de ingreso no cuenta: lunes + 3 → jueves', () => {
    expect(sumarDiasHabiles('2026-10-05', 3)).toBe('2026-10-08');
  });

  it('salta el fin de semana', () => {
    expect(sumarDiasHabiles('2026-10-01', 3)).toBe('2026-10-06'); // jue → vie 2, lun 5, mar 6
    expect(sumarDiasHabiles('2026-10-03', 1)).toBe('2026-10-05'); // ingreso en sábado
  });

  it('salta los festivos de Colombia', () => {
    // jue 8 → vie 9, (sáb, dom, lun 12 festivo), mar 13, mié 14
    expect(sumarDiasHabiles('2026-10-08', 3)).toBe('2026-10-14');
    // jue 31-dic → vie 1-ene festivo → lun 4-ene
    expect(sumarDiasHabiles('2026-12-31', 1)).toBe('2027-01-04');
  });
});

describe('diasHabilesEntre', () => {
  it('cuenta hacia delante sin el día de partida y con el de llegada', () => {
    expect(diasHabilesEntre('2026-10-06', '2026-10-06')).toBe(0);
    expect(diasHabilesEntre('2026-10-06', '2026-10-08')).toBe(2);
    expect(diasHabilesEntre('2026-10-09', '2026-10-14')).toBe(2); // fin de semana + festivo
  });

  it('hacia atrás es negativo, y un fin de semana no suma atraso', () => {
    expect(diasHabilesEntre('2026-10-06', '2026-10-02')).toBe(-2);
    expect(diasHabilesEntre('2026-10-03', '2026-10-02')).toBe(0);
  });

  it('aguanta un atraso de años (el contador de Ausencias corta en 366 días)', () => {
    const d = diasHabilesEntre('2026-10-06', '2024-01-02');
    expect(d).toBeLessThan(-650);
    expect(d).toBeGreaterThan(-720);
  });
});

describe('calcularPlazo', () => {
  const hoy = '2026-10-06';

  it('dentro del plazo', () => {
    expect(calcularPlazo('2026-10-05', 3, hoy)).toEqual({ fechaLimite: '2026-10-08', diasHabiles: 2, estadoPlazo: 'EN_PLAZO' });
  });

  it('vence hoy', () => {
    expect(calcularPlazo('2026-10-01', 3, hoy)).toEqual({ fechaLimite: '2026-10-06', diasHabiles: 0, estadoPlazo: 'VENCE_HOY' });
  });

  it('vencido: días hábiles de atraso en negativo', () => {
    expect(calcularPlazo('2026-09-28', 4, hoy)).toEqual({ fechaLimite: '2026-10-02', diasHabiles: -2, estadoPlazo: 'VENCIDO' });
  });

  it('sin plazo configurado, sin ingreso o con una fecha imposible → SIN_PLAZO', () => {
    const sin = { fechaLimite: null, diasHabiles: null, estadoPlazo: 'SIN_PLAZO' };
    expect(calcularPlazo('2026-10-05', null, hoy)).toEqual(sin);
    expect(calcularPlazo(null, 3, hoy)).toEqual(sin);
    expect(calcularPlazo('2026-02-30', 3, hoy)).toEqual(sin);
  });
});

describe('festivosDelEje', () => {
  it('trae los festivos desde 60 días antes de hoy hasta pasado el último límite', () => {
    const f = festivosDelEje('2026-10-06', ['2026-10-08', null, '2027-01-05']);
    expect(f).toContain('2026-08-07'); // dentro de los 60 días hacia atrás
    expect(f).toContain('2026-10-12');
    expect(f).toContain('2027-01-01');
    expect(f).not.toContain('2026-07-20'); // antes de la ventana
    expect(f).not.toContain('2027-03-22'); // después
    expect([...f].sort()).toEqual(f);
  });
});

describe('043_trazabilidad_plazos.sql', () => {
  // La semilla va escrita a mano en el SQL (las migraciones sólo ejecutan
  // .sql). Este candado vigila que cada clave sembrada sea la que calcula
  // claveTipoServicio: si no coincidieran, el tipo de Desk no casaría con su fila.
  const SQL = readFileSync(fileURLToPath(new URL('../users/migrations/043_trazabilidad_plazos.sql', import.meta.url)), 'utf8');
  const semilla = [...SQL.matchAll(/\('([^']+)',\s*'([^']+)',\s*(NULL|\d+)\)/g)].map((m) => ({
    clave: m[1],
    etiqueta: m[2],
    dias: m[3] === 'NULL' ? null : Number(m[3]),
  }));

  it('cada clave sembrada es la normalización de su etiqueta', () => {
    expect(semilla.length).toBeGreaterThanOrEqual(6);
    for (const s of semilla) expect(s.clave).toBe(claveTipoServicio(s.etiqueta));
  });

  it('siembra Diagnóstico = 3 y Calibración = 4; el resto, sin plazo', () => {
    const conPlazo = semilla.filter((s) => s.dias !== null);
    expect(conPlazo).toEqual([
      { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3 },
      { clave: 'calibracion', etiqueta: 'Calibración', dias: 4 },
    ]);
    expect(semilla.filter((s) => s.dias === null).map((s) => s.etiqueta).sort()).toEqual(['Garantía', 'Mantenimiento', 'No aplica', 'Otro']);
  });

  it('nunca pisa lo que edite el usuario ni toca el esquema desk', () => {
    expect(SQL).toMatch(/ON CONFLICT \(clave\) DO NOTHING/);
    expect(SQL).not.toMatch(/\bdesk\./);
  });
});

describe('044_trazabilidad_servicios_tipo.sql', () => {
  // La 044 se vuelve a ejecutar en cada arranque: sólo puede crear lo que falte.
  // Cualquier sentencia que escriba o borre datos se llevaría por delante los
  // tipos puestos a mano.
  const SQL = readFileSync(fileURLToPath(new URL('../users/migrations/044_trazabilidad_servicios_tipo.sql', import.meta.url)), 'utf8');
  const sentencias = SQL.replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  it('sólo crea, y siempre con IF NOT EXISTS', () => {
    expect(sentencias.length).toBeGreaterThanOrEqual(1);
    for (const s of sentencias) expect(s).toMatch(/^CREATE (SCHEMA|TABLE|INDEX) IF NOT EXISTS /);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS portal\.tmc_servicios_tipo/);
  });

  it('no toca el esquema desk ni le pone una clave foránea', () => {
    expect(SQL).not.toMatch(/\bdesk\./);
    expect(SQL).not.toMatch(/\bREFERENCES\b/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 043', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'043_trazabilidad_plazos\.sql',\s*'044_trazabilidad_servicios_tipo\.sql'/);
  });
});
