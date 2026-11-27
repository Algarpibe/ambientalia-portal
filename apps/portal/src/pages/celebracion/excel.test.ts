import { describe, it, expect } from 'vitest';
import { COLUMNAS_EXCEL, filasExcel, nombreFicheroExcel } from './excel';
import { eventoDePrueba, resumenDePrueba } from './fixtures';

describe('Excel de confirmaciones', () => {
  it('una cabecera y una fila por persona, con textos legibles', () => {
    const filas = filasExcel(resumenDePrueba(), eventoDePrueba().preferencias);
    expect(filas[0]).toEqual(COLUMNAS_EXCEL);
    expect(filas[1]).toEqual(['Ana Ruiz', 'Va', 'Opción vegetariana', '¡Allá estaré!', '2026-12-01 10:00']);
    expect(filas[2]).toEqual(['Bruno Díaz', 'No va', '', '', '2026-12-02 10:00']);
    expect(filas[3]).toEqual(['Carla Gómez', 'Sin responder', '', '', '']);
  });

  it('el fichero lleva el evento y la fecha', () => {
    expect(nombreFicheroExcel('fin-de-ano-2026', '2026-12-05')).toBe('Confirmaciones_fin-de-ano-2026_2026-12-05.xlsx');
  });
});
