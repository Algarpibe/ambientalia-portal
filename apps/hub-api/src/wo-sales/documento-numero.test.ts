import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ordenarParaAsignar, numerosANumerar } from './documento-numero.js';

describe('numerosANumerar', () => {
  it('excluye las OV sin líneas y conserva el orden de entrada', () => {
    const l = [{}];
    expect(
      numerosANumerar([
        { numero: 'OV-2026-213', lineas: l },
        { numero: 'OV-2026-150', lineas: [] },
        { numero: 'OV-2026-212', lineas: l },
      ])
    ).toEqual(['OV-2026-213', 'OV-2026-212']);
  });
});

describe('ordenarParaAsignar', () => {
  it('ordena por año y consecutivo de la OV', () => {
    expect(ordenarParaAsignar(['OV-2026-213', 'OV-2025-199', 'OV-2026-212'])).toEqual([
      'OV-2025-199',
      'OV-2026-212',
      'OV-2026-213',
    ]);
  });

  it('compara el consecutivo como número, no como texto: la 999 va antes que la 1000', () => {
    expect(ordenarParaAsignar(['OV-2026-1000', 'OV-2026-999'])).toEqual(['OV-2026-999', 'OV-2026-1000']);
  });

  it('los números que no cumplen OV-AAAA-XXX van al final, en orden de texto', () => {
    expect(ordenarParaAsignar(['OV-2026-1000-01', 'OV-2026-005', 'ABC'])).toEqual([
      'OV-2026-005',
      'ABC',
      'OV-2026-1000-01',
    ]);
  });

  it('no modifica el arreglo que recibe', () => {
    const entrada = ['OV-2026-213', 'OV-2026-212'];
    ordenarParaAsignar(entrada);
    expect(entrada).toEqual(['OV-2026-213', 'OV-2026-212']);
  });
});

describe('migración 070', () => {
  it('está apuntada en MIGRATIONS, detrás de la 069 (la última la vigila equipos/migracion.test.ts)', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'069_trazabilidad_avisos_envios\.sql',\s*'070_wo_sales_documento_numero\.sql'[,\]]/);
  });
});

describe('migración 070: siembra', () => {
  const sql = readFileSync(
    fileURLToPath(new URL('../users/migrations/070_wo_sales_documento_numero.sql', import.meta.url)),
    'utf8'
  );
  const semillas = [...sql.matchAll(/\('(OV-\d{4}-\d+)',\s*(\d+),\s*'congelado'\)/g)].map((m) => [m[1], Number(m[2])]);

  it('congela 38 OV, del 1 al 38 sin huecos', () => {
    expect(semillas.map((s) => s[1])).toEqual(Array.from({ length: 38 }, (_, i) => i + 1));
  });

  it('la OV-2026-212 queda congelada con el 38 (ya facturada: no saldrá en el archivo)', () => {
    expect(semillas).toContainEqual(['OV-2026-211', 37]);
    expect(semillas).toContainEqual(['OV-2026-212', 38]);
  });
});
