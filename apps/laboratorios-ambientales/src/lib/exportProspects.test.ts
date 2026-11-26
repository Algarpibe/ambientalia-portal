import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import type { Prospecto } from './prospects';
import { COLUMNAS_EXCEL, HOJA_EXCEL, filasExcel, nombreDeFichero } from './exportProspects';

// Hoy + 6 meses = 2027-05-26.
const HOY = '2026-11-26';

// Datos ficticios: el repo es público.
const prospecto = (over: Partial<Prospecto> = {}): Prospecto => ({
  codigo: '101',
  nombre: 'LABORATORIO ANDINO DE AGUAS S.A.S.',
  nit: '900.000.001-1',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  contacto: 'Contacto Ficticio Uno',
  telefono: '6040000001',
  correo: 'lab.andino@example.com',
  matrices: ['Agua', 'Suelo'],
  metodos: ['SM 5520 B', 'SM 5520 C'],
  grupo: 'infrarrojo',
  vigenciaMasProxima: '2027-04-21',
  ...over,
});

describe('filasExcel', () => {
  it('la primera fila es la cabecera, con las trece columnas en su orden', () => {
    expect(filasExcel([], HOY)).toEqual([
      [
        'Laboratorio',
        'NIT',
        'Código',
        'Ciudad',
        'Departamento',
        'Grupo',
        'Matrices',
        'Métodos',
        'Vigencia más próxima',
        'Estado de la vigencia',
        'Contacto',
        'Teléfono',
        'Correo',
      ],
    ]);
  });

  it('una fila por laboratorio, con matrices y métodos separados por «; »', () => {
    expect(filasExcel([prospecto()], HOY)[1]).toEqual([
      'LABORATORIO ANDINO DE AGUAS S.A.S.',
      '900.000.001-1',
      '101',
      'Medellín',
      'Antioquia',
      'Usan infrarrojo',
      'Agua; Suelo',
      'SM 5520 B; SM 5520 C',
      '2027-04-21',
      'Vence en menos de 6 meses',
      'Contacto Ficticio Uno',
      '6040000001',
      'lab.andino@example.com',
    ]);
  });

  it('sin fecha, la vigencia va vacía y el estado dice «Sin fecha»', () => {
    const fila = filasExcel([prospecto({ grupo: 'gravimetria', vigenciaMasProxima: null })], HOY)[1];
    expect(fila[5]).toBe('Solo gravimetría');
    expect(fila[8]).toBe('');
    expect(fila[9]).toBe('Sin fecha');
  });

  it('respeta el orden recibido, que es el de la pantalla', () => {
    const filas = filasExcel([prospecto({ nombre: 'Zeta' }), prospecto({ nombre: 'Alfa' })], HOY);
    expect(filas.slice(1).map((fila) => fila[0])).toEqual(['Zeta', 'Alfa']);
  });

  it('cada fila tiene una celda por columna', () => {
    for (const fila of filasExcel([prospecto(), prospecto({ vigenciaMasProxima: null })], HOY)) {
      expect(fila).toHaveLength(COLUMNAS_EXCEL.length);
    }
  });

  it('en la hoja, un texto que empieza por «=» es una celda de texto y no una fórmula', () => {
    const hoja = XLSX.utils.aoa_to_sheet(filasExcel([prospecto({ nombre: '=HYPERLINK("x")' })], HOY));
    const celda = hoja['A2'] as XLSX.CellObject;
    expect(celda.t).toBe('s');
    expect(celda.f).toBeUndefined();
    expect(celda.v).toBe('=HYPERLINK("x")');
  });

  it('la hoja se llama «Prospectos»', () => {
    expect(HOJA_EXCEL).toBe('Prospectos');
  });
});

describe('nombreDeFichero', () => {
  it('lleva el grupo y la fecha', () => {
    expect(nombreDeFichero('infrarrojo', HOY)).toBe('prospectos-grasas-aceites-infrarrojo-2026-11-26.xlsx');
    expect(nombreDeFichero('gravimetria', HOY)).toBe('prospectos-grasas-aceites-gravimetria-2026-11-26.xlsx');
  });
});
