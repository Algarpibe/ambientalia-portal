import { describe, expect, it } from 'vitest';
import { buildCsvTemplate, CSV_TEMPLATE_HEADER, parsePointsCsv } from './csv';

describe('buildCsvTemplate', () => {
  it('uses ; as separator, starts with a BOM for Excel and has the documented header', () => {
    const t = buildCsvTemplate('VERIFICATION_3_CYCLES');
    expect(t.startsWith('﻿')).toBe(true);
    const lines = t.slice(1).trim().split(/\r?\n/);
    expect(lines[0]).toBe(CSV_TEMPLATE_HEADER.join(';'));
    expect(lines[0]).toBe('ciclo;orden;setpoint_ppb;x_ppb;y_ppb;t_celda_x_c;t_celda_y_c;p_celda_x_torr;p_celda_y_torr');
  });
  it('3 cycles × 7 points (TAD example setpoints) for a verification, 1 cycle for a reverification', () => {
    const v = buildCsvTemplate('VERIFICATION_3_CYCLES').slice(1).trim().split(/\r?\n/);
    expect(v).toHaveLength(1 + 21);
    expect(v[1]).toBe('1;1;0;;;;;;');
    expect(v[3]).toBe('1;3;52;;;;;;');
    expect(v[21]).toBe('3;7;200;;;;;;');
    const r = buildCsvTemplate('REVERIFICATION_1_CYCLE').slice(1).trim().split(/\r?\n/);
    expect(r).toHaveLength(1 + 7);
  });
  it('custom setpoints use comma decimals', () => {
    const t = buildCsvTemplate('REVERIFICATION_1_CYCLE', [0, 15.5]).slice(1).trim().split(/\r?\n/);
    expect(t[2]).toBe('1;2;15,5;;;;;;');
  });
});

describe('parsePointsCsv', () => {
  it('parses the template format (; separator, comma decimals) grouped by cycle and ordered', () => {
    const text = [
      '﻿ciclo;orden;setpoint_ppb;x_ppb;y_ppb;t_celda_x_c;t_celda_y_c;p_celda_x_torr;p_celda_y_torr',
      '1;2;15;14,9;14,8;25,1;;640;',
      '1;1;0;0;0,3;;;;',
      '2;1;0;0,1;0,2;;;;',
    ].join('\r\n');
    const r = parsePointsCsv(text);
    expect(r.errors).toEqual([]);
    expect(r.unit).toBe('ppb');
    expect(r.cycles.map((c) => c.index)).toEqual([1, 2]);
    expect(r.cycles[0].rows[0]).toMatchObject({ setpoint: '0', x: '0', y: '0,3' });
    expect(r.cycles[0].rows[1]).toMatchObject({ setpoint: '15', x: '14,9', y: '14,8', cellTempX: '25,1', cellPressX: '640' });
  });

  it('accepts , as separator with dot decimals and quoted comma decimals', () => {
    const text = 'ciclo,orden,setpoint_ppb,x_ppb,y_ppb\n1,1,0,0,0.3\n1,2,15,"14,9",14.8\n';
    const r = parsePointsCsv(text);
    expect(r.errors).toEqual([]);
    expect(r.cycles[0].rows[1]).toMatchObject({ x: '14,9', y: '14.8' });
  });

  it('header aliases: case, accents and spaces do not matter; orden is optional (file order)', () => {
    const text = 'Ciclo; Setpoint ppb ;X ppb;Y ppb\n1;0;0;0,1\n1;15;15;15,2';
    const r = parsePointsCsv(text);
    expect(r.errors).toEqual([]);
    expect(r.cycles[0].rows.map((p) => p.setpoint)).toEqual(['0', '15']);
  });

  it('ppm columns set the unit to ppm', () => {
    const r = parsePointsCsv('ciclo;setpoint_ppm;x_ppm;y_ppm\n1;0,015;0,0149;0,0148');
    expect(r.errors).toEqual([]);
    expect(r.unit).toBe('ppm');
  });

  it('mixed units, missing columns, bad numbers and bad cycles are reported with the line number', () => {
    expect(parsePointsCsv('ciclo;x_ppb;y_ppm\n1;1;1').errors[0]).toMatch(/misma unidad/);
    expect(parsePointsCsv('ciclo;x_ppb\n1;1').errors[0]).toMatch(/y_ppb/);
    const bad = parsePointsCsv('ciclo;x_ppb;y_ppb\n1;abc;1\n4;1;1\n1;2');
    expect(bad.errors).toEqual([
      expect.stringMatching(/Línea 2.*x/),
      expect.stringMatching(/Línea 3.*ciclo/),
      expect.stringMatching(/Línea 4.*columnas/),
    ]);
  });

  it('blank lines are skipped; an empty file is an error', () => {
    expect(parsePointsCsv('ciclo;x_ppb;y_ppb\n\n1;1;1\n\n').cycles[0].rows).toHaveLength(1);
    expect(parsePointsCsv('').errors[0]).toMatch(/vacío/);
  });
});
