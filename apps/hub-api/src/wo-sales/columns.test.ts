import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COLUMNS } from './columns.js';

// La muestra es la fuente de verdad del formato: 57 columnas en Windows-1252.
const MUESTRA = new URL(
  '../../../WO-sales/DocumentosVentasEncabezadosMovimientoInventarioWO_Muestra.csv',
  import.meta.url
);

describe('COLUMNS', () => {
  it('tiene 57 columnas', () => {
    expect(COLUMNS).toHaveLength(57);
  });

  it('coincide exactamente con la cabecera del CSV de muestra', () => {
    const bytes = readFileSync(MUESTRA);
    const texto = new TextDecoder('windows-1252').decode(bytes);
    // Se parte con /\r?\n/ y no con '\r\n': la muestra está versionada con LF, y
    // git solo la entrega con CRLF donde autocrlf lo hace (Windows). Asumir CRLF
    // hacía que en Linux (CI) no se encontrara ningún salto: el archivo entero se
    // tomaba como una línea y la cabecera salía con 393 campos en vez de 57.
    // El EOL real del archivo que se genera no depende de esto: lo fija builder.ts.
    const cabecera = texto.split(/\r?\n/)[0].split(';');
    expect(COLUMNS).toEqual(cabecera);
  });

  it('no tiene columnas duplicadas', () => {
    expect(new Set(COLUMNS).size).toBe(COLUMNS.length);
  });
});
