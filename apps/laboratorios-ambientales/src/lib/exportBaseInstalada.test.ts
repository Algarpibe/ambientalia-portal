import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import type { EquipoInstalado } from './baseInstalada';
import type { CruceZoho } from './clientes';
import { COLUMNAS_EXCEL, HOJA_EXCEL, filasExcel, nombreDeFichero } from './exportBaseInstalada';

// Hoy + 6 meses = 2027-05-27.
const HOY = '2026-11-27';

// Datos ficticios: el repo es público. Las marcas y los códigos son reales.
const equipo = (over: Partial<EquipoInstalado> = {}): EquipoInstalado => ({
  codigo: '201',
  laboratorio: 'LABORATORIO DE AIRE DEL NORTE S.A.S.',
  nit: '900.000.001-7',
  ciudad: 'Bucaramanga',
  departamento: 'Santander',
  contacto: 'Contacto Ficticio Uno',
  telefono: '6070000001',
  correo: 'aire.norte@example.com',
  serie: 'SN-0001',
  estaciones: ['Estación Ficticia Centro', 'Estación Ficticia Sur'],
  marcasYModelos: [
    { marca: 'Grimm', modelo: 'EDM180' },
    { marca: 'Tisch Environmental / New Star Environmental', modelo: 'TE-6070 / NS-6070' },
  ],
  codigosEpa: ['EQPM-0311-195', 'RFPS-0202-141'],
  variables: ['Material Particulado Menor a 10 micras', 'Partículas Suspendidas Totales'],
  vigenciaMasProxima: '2027-04-21',
  ...over,
});

describe('filasExcel', () => {
  it('la primera fila es la cabecera, con las dieciocho columnas en su orden', () => {
    expect(filasExcel([], HOY)).toEqual([
      [
        'Laboratorio',
        'NIT',
        'Código',
        'Ciudad',
        'Departamento',
        'Estación',
        'Marca',
        'Modelo',
        'Códigos EPA',
        'Variables',
        'Serie',
        'Vigencia más próxima',
        'Estado de la vigencia',
        'Contacto',
        'Teléfono',
        'Correo',
        'Cliente',
        'Última factura',
      ],
    ]);
  });

  it('una fila por equipo; las listas, unidas por «; », y cada marca con su modelo en el mismo orden', () => {
    expect(filasExcel([equipo()], HOY)[1]).toEqual([
      'LABORATORIO DE AIRE DEL NORTE S.A.S.',
      '900.000.001-7',
      '201',
      'Bucaramanga',
      'Santander',
      'Estación Ficticia Centro; Estación Ficticia Sur',
      'Grimm; Tisch Environmental / New Star Environmental',
      'EDM180; TE-6070 / NS-6070',
      'EQPM-0311-195; RFPS-0202-141',
      'Material Particulado Menor a 10 micras; Partículas Suspendidas Totales',
      'SN-0001',
      '2027-04-21',
      'Vence en menos de 6 meses',
      'Contacto Ficticio Uno',
      '6070000001',
      'aire.norte@example.com',
      '',
      '',
    ]);
  });

  it('con dos pares de la misma marca y distinto modelo, la marca se repite para que la n.º i siga siendo la del modelo n.º i', () => {
    const fila = filasExcel(
      [
        equipo({
          marcasYModelos: [
            { marca: 'Thermo Scientific', modelo: '43i' },
            { marca: 'Thermo Scientific', modelo: '49i' },
          ],
        }),
      ],
      HOY,
    )[1];
    expect(fila[6]).toBe('Thermo Scientific; Thermo Scientific');
    expect(fila[7]).toBe('43i; 49i');
  });

  it('sin estación ni marca: «Sin estación», «Sin identificar» y el modelo vacío', () => {
    const fila = filasExcel([equipo({ estaciones: [], marcasYModelos: [], codigosEpa: ['RFNA-1289-070'] })], HOY)[1];
    expect(fila[5]).toBe('Sin estación');
    expect(fila[6]).toBe('Sin identificar');
    expect(fila[7]).toBe('');
    expect(fila[8]).toBe('RFNA-1289-070');
  });

  it('sin fecha, la vigencia va vacía y el estado dice «Sin fecha»', () => {
    const fila = filasExcel([equipo({ vigenciaMasProxima: null })], HOY)[1];
    expect(fila[11]).toBe('');
    expect(fila[12]).toBe('Sin fecha');
  });

  it('con el cruce, las dos últimas columnas llevan el estado y la última factura', () => {
    const cruce: CruceZoho = new Map([
      ['900000001', { ultimaFactura: '2026-03-10', ocmaVendido: '2024-05-02', ultimosRepuestos: null }],
    ]);
    expect(filasExcel([equipo()], HOY, cruce)[1].slice(-2)).toEqual(['Cliente activo', '2026-03-10']);
  });

  it('con el cruce, un laboratorio que no está en Zoho lo dice y deja la fecha vacía', () => {
    expect(filasExcel([equipo()], HOY, new Map())[1].slice(-2)).toEqual(['No está en Zoho', '']);
  });

  it('sin cruce (consultando o con error), las dos columnas van vacías', () => {
    expect(filasExcel([equipo()], HOY, null)[1].slice(-2)).toEqual(['', '']);
  });

  it('respeta el orden recibido, que es el de la pantalla', () => {
    const filas = filasExcel([equipo({ serie: 'Z-1' }), equipo({ serie: 'A-1' })], HOY);
    expect(filas.slice(1).map((fila) => fila[10])).toEqual(['Z-1', 'A-1']);
  });

  it('cada fila tiene una celda por columna', () => {
    const sinNada = equipo({ estaciones: [], marcasYModelos: [], codigosEpa: [], vigenciaMasProxima: null });
    for (const fila of filasExcel([equipo(), sinNada], HOY, new Map())) {
      expect(fila).toHaveLength(COLUMNAS_EXCEL.length);
    }
  });

  it('en la hoja, un texto que empieza por «=» es una celda de texto y no una fórmula', () => {
    const hoja = XLSX.utils.aoa_to_sheet(filasExcel([equipo({ laboratorio: '=HYPERLINK("x")' })], HOY));
    const celda = hoja['A2'] as XLSX.CellObject;
    expect(celda.t).toBe('s');
    expect(celda.f).toBeUndefined();
    expect(celda.v).toBe('=HYPERLINK("x")');
  });

  it('la hoja se llama «Base instalada de aire»', () => {
    expect(HOJA_EXCEL).toBe('Base instalada de aire');
  });
});

describe('nombreDeFichero', () => {
  it('lleva la fecha', () => {
    expect(nombreDeFichero(HOY)).toBe('base-instalada-aire-2026-11-27.xlsx');
  });
});
