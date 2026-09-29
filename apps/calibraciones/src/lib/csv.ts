/**
 * Point capture CSV: the downloadable template and a lenient parser.
 *
 * Template (DECISIONS D-029): `;` separator, comma decimal, UTF-8 with BOM —
 * what Excel in es-CO opens and saves without an import wizard. One row per
 * point; `ciclo` groups them. The parser also accepts `,` (then decimals must
 * be dots or quoted) and tab separators, and ppm columns (`x_ppm`...).
 */
import type { StoredVerificationKind } from '../types';
import { cycleCountOf, emptyRow, type CycleRows, type PointRow, type Unit } from './draft';
import { formatInputNumber } from './format';
import { parseDecimal } from './parse';

export const CSV_TEMPLATE_HEADER = [
  'ciclo',
  'orden',
  'setpoint_ppb',
  'x_ppb',
  'y_ppb',
  't_celda_x_c',
  't_celda_y_c',
  'p_celda_x_torr',
  'p_celda_y_torr',
] as const;

/** TAD 2023 example for a 200 ppb scale (see D-009). */
export const EXAMPLE_SETPOINTS = [0, 15, 52, 89, 126, 163, 200];

export function buildCsvTemplate(kind: StoredVerificationKind, setpointsPpb: readonly number[] = EXAMPLE_SETPOINTS): string {
  const lines: string[] = [CSV_TEMPLATE_HEADER.join(';')];
  for (let c = 1; c <= cycleCountOf(kind); c++) {
    setpointsPpb.forEach((s, i) => {
      lines.push([String(c), String(i + 1), formatInputNumber(s), '', '', '', '', '', ''].join(';'));
    });
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

type Column = 'cycle' | 'order' | 'setpoint' | 'x' | 'y' | 'cellTempX' | 'cellTempY' | 'cellPressX' | 'cellPressY';

const normalize = (h: string) =>
  h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const FIXED_COLUMNS: Record<string, Column> = {
  ciclo: 'cycle',
  orden: 'order',
  t_celda_x_c: 'cellTempX',
  t_celda_y_c: 'cellTempY',
  p_celda_x_torr: 'cellPressX',
  p_celda_y_torr: 'cellPressY',
};

const CONCENTRATION = /^(setpoint|x|y)_(ppb|ppm)$/;

/** Splits one line honouring double quotes ("14,9"). */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export interface CsvParseResult {
  cycles: CycleRows[];
  unit: Unit;
  /** es-CO messages with the line number; non-empty → do not import. */
  errors: string[];
}

const MAX_CYCLE = 3;

export function parsePointsCsv(input: string): CsvParseResult {
  const text = input.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((l) => l.trim() !== '');
  if (headerIndex < 0) return { cycles: [], unit: 'ppb', errors: ['El archivo está vacío.'] };

  const headerLine = lines[headerIndex];
  const sep = headerLine.includes(';') ? ';' : headerLine.includes('\t') ? '\t' : ',';
  const header = splitLine(headerLine, sep).map(normalize);

  const columns: (Column | null)[] = [];
  const units = new Set<Unit>();
  for (const h of header) {
    const m = CONCENTRATION.exec(h);
    if (m) {
      columns.push(m[1] as Column);
      units.add(m[2] as Unit);
    } else {
      columns.push(FIXED_COLUMNS[h] ?? null);
    }
  }
  if (units.size > 1) {
    return { cycles: [], unit: 'ppb', errors: ['Las columnas setpoint, x e y deben tener la misma unidad (todas ppb o todas ppm).'] };
  }
  const unit: Unit = units.has('ppm') ? 'ppm' : 'ppb';
  const missing = (['cycle', 'x', 'y'] as const).filter((c) => !columns.includes(c));
  if (missing.length) {
    const names = { cycle: 'ciclo', x: `x_${unit}`, y: `y_${unit}` };
    return { cycles: [], unit, errors: [`Faltan columnas obligatorias: ${missing.map((m) => names[m]).join(', ')}.`] };
  }

  const errors: string[] = [];
  const byCycle = new Map<number, { order: number; seq: number; row: PointRow }[]>();
  let seq = 0;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const lineNo = i + 1;
    const cells = splitLine(line, sep);
    if (cells.length !== header.length) {
      errors.push(`Línea ${lineNo}: tiene ${cells.length} columnas y el encabezado ${header.length}.`);
      continue;
    }
    const row = emptyRow();
    let cycle = Number.NaN;
    let order = Number.NaN;
    let bad = false;
    columns.forEach((col, j) => {
      if (!col) return;
      const v = cells[j];
      if (col === 'cycle' || col === 'order') {
        const n = Number(v);
        if (col === 'cycle') cycle = n;
        else order = v === '' ? Number.NaN : n;
        return;
      }
      const n = parseDecimal(v);
      if (n !== null && Number.isNaN(n)) {
        errors.push(`Línea ${lineNo}: «${v}» no es un número en la columna ${header[j]} (${col}).`);
        bad = true;
      }
      row[col] = v;
    });
    if (!Number.isInteger(cycle) || cycle < 1 || cycle > MAX_CYCLE) {
      errors.push(`Línea ${lineNo}: el ciclo debe ser 1, 2 o 3.`);
      continue;
    }
    if (bad) continue;
    const list = byCycle.get(cycle) ?? [];
    list.push({ order: Number.isFinite(order) ? order : Number.POSITIVE_INFINITY, seq: seq++, row });
    byCycle.set(cycle, list);
  }

  const cycles = [...byCycle.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, list]) => ({
      index,
      rows: list.sort((a, b) => a.order - b.order || a.seq - b.seq).map((e) => e.row),
    }));
  return { cycles, unit, errors };
}
