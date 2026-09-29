/**
 * SheetSpec[] → .xlsx bytes with SheetJS. Import this module lazily
 * (`await import('./lib/xlsx')`) so SheetJS stays out of the main chunk.
 */
import * as XLSX from 'xlsx';
import type { Cell, SheetSpec } from './exports';

const excelValue = (c: Cell) => (typeof c === 'boolean' ? (c ? 'Sí' : 'No') : c);

export function workbookBytes(sheets: readonly SheetSpec[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.header, ...s.rows.map((r) => r.map(excelValue))]);
    s.rows.forEach((row, r) => {
      row.forEach((value, c) => {
        const z = s.rowFormats?.[r] ?? s.formats?.[c] ?? null;
        if (typeof value !== 'number' || !z) return;
        const cell = ws[XLSX.utils.encode_cell({ r: r + 1, c })];
        if (cell) cell.z = z;
      });
    });
    ws['!cols'] = s.header.map((h, c) => ({
      wch: Math.min(60, Math.max(h.length, ...s.rows.map((r) => String(r[c] ?? '').length)) + 2),
    }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
