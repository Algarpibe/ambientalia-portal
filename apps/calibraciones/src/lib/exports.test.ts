import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { CSV_TEMPLATE_HEADER, parsePointsCsv } from './csv';
import { BENCH_6103, SRP, t3Detail } from './fixtures.test-data';
import {
  equipmentSheet,
  expirationsSheet,
  sheetToCsv,
  toCsv,
  verificationListSheet,
  verificationPointsCsv,
  verificationSheets,
} from './exports';
import { workbookBytes } from './xlsx';
import type { EquipmentWithValidity, ExpirationItem, VerificationListItem } from '../types';

const ctx = () => ({ verification: t3Detail(), reference: SRP, candidate: BENCH_6103, referenceVerification: null });

describe('toCsv', () => {
  it('BOM, ";" separator, CRLF, comma decimals, Sí/No and quoting', () => {
    const csv = toCsv(['a', 'b', 'c', 'd'], [[1.5, 'x;y', true, null], [-0.25, 'di "hola"', false, 'ok']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual(['a;b;c;d', '1,5;"x;y";Sí;', '-0,25;"di ""hola""";No;ok', '']);
  });
});

describe('verificationPointsCsv', () => {
  it('starts with the import template columns and adds the computed ones', () => {
    const csv = verificationPointsCsv(t3Detail());
    const [header, first] = csv.slice(1).split('\r\n');
    expect(header).toBe([...CSV_TEMPLATE_HEADER, 'x_std_ppb', 'tipo_diferencia', 'diferencia', 'cumple'].join(';'));
    expect(first).toBe('1;1;0;0;0,3;25,1;25,3;560,1;559,8;0;ABS_PPB;0,3;Sí');
  });

  it('round-trips through the import parser (same cycles and readings)', () => {
    const parsed = parsePointsCsv(verificationPointsCsv(t3Detail()));
    expect(parsed.errors).toEqual([]);
    expect(parsed.cycles.map((c) => c.index)).toEqual([1, 2, 3]);
    expect(parsed.cycles[1].rows.map((r) => r.y)).toEqual(['0,1', '15', '52,9', '90,2', '127,4', '164,3', '201,9']);
    expect(parsed.cycles[0].rows[0].cellPressY).toBe('559,8');
  });
});

describe('verificationSheets', () => {
  it('Resumen, Puntos, Ciclos, Reglas', () => {
    const sheets = verificationSheets(ctx());
    expect(sheets.map((s) => s.name)).toEqual(['Resumen', 'Puntos', 'Ciclos', 'Reglas']);
  });

  it('Resumen keeps full-precision numbers (display format only) and the versions', () => {
    const [resumen] = verificationSheets(ctx());
    const get = (k: string) => resumen.rows.find((r) => r[0] === k)?.[1];
    expect(get('Registro')).toBe('3f2a9c1e-0000-4000-8000-000000000001');
    expect(get('Procedimiento')).toBe('IN.5.5.3-XX');
    expect(get('Resultado')).toBe('CONFORME');
    expect(get('m prom.')).toBeCloseTo(1.0073827, 6);
    expect(get('Versión del motor')).toBe('1.0.0');
    expect(get('Versión de límites')).toBe('1.0.0');
  });

  it('Puntos has one row per point, Ciclos one per cycle, Reglas every rule with its reference', () => {
    const [, puntos, ciclos, reglas] = verificationSheets(ctx());
    expect(puntos.rows).toHaveLength(21);
    expect(ciclos.rows).toHaveLength(3);
    expect(ciclos.rows[0][1]).toBeCloseTo(1.00706, 5);
    const refCol = reglas.header.indexOf('Referencia normativa');
    expect(reglas.rows.every((r) => typeof r[refCol] === 'string' && (r[refCol] as string).length > 0)).toBe(true);
    expect(reglas.rows.some((r) => r[0] === 'V1')).toBe(true);
  });
});

describe('list exports', () => {
  it('equipment with its validity', () => {
    const items: EquipmentWithValidity[] = [{ ...BENCH_6103, validity: { dueDate: '2027-09-01', daysLeft: 337, bucket: 'OK' } }];
    const s = equipmentSheet(items);
    expect(s.name).toBe('Equipos');
    expect(s.rows[0].slice(0, 3)).toEqual(['6103-S', 'Environics', '6103']);
    expect(s.rows[0]).toContain('Vigente');
    expect(s.rows[0]).toContain('01/09/2027');
  });

  it('verifications', () => {
    const v: VerificationListItem = { ...t3Detail(), referenceInternalCode: 'SRP-CALAIRE', candidateInternalCode: '6103-S' };
    const s = verificationListSheet([v]);
    expect(s.name).toBe('Verificaciones');
    expect(s.rows[0]).toEqual(expect.arrayContaining(['01/09/2026', 'SRP-CALAIRE', '6103-S', 'Aprobada', 'CONFORME']));
  });

  it('expirations', () => {
    const e: ExpirationItem = {
      equipmentId: 'x',
      internalCode: '6103-T',
      brand: 'Environics',
      model: '6103',
      currentLevel: 3,
      application: 'FIELD',
      verificationId: null,
      validUntil: '2026-10-05',
      reverificationDue: null,
      dueDate: '2026-10-05',
      daysLeft: 6,
      bucket: 'DUE_15',
    };
    const s = expirationsSheet([e]);
    expect(s.name).toBe('Vencimientos');
    expect(s.rows[0]).toEqual(expect.arrayContaining(['6103-T', 'Campo', '05/10/2026', 6, 'Vence en ≤ 15 días']));
    expect(sheetToCsv(s).split('\r\n')[1]).toContain('6103-T;Environics;6103;3;Campo');
  });
});

describe('workbookBytes (SheetJS)', () => {
  it('writes an .xlsx that reads back with the same sheets, numbers and display formats', () => {
    const bytes = workbookBytes(verificationSheets(ctx()));
    const wb = XLSX.read(bytes, { type: 'array', cellNF: true });
    expect(wb.SheetNames).toEqual(['Resumen', 'Puntos', 'Ciclos', 'Reglas']);
    const ciclos = wb.Sheets.Ciclos;
    expect(ciclos.A1.v).toBe('Ciclo');
    expect(ciclos.B2.t).toBe('n');
    expect(ciclos.B2.v).toBeCloseTo(1.00706, 5);
    expect(ciclos.B2.z).toBe('0.00000');
    expect(ciclos.C2.z).toBe('0.000');
  });
});
