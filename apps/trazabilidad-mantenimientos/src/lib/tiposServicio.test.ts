import { describe, it, expect } from 'vitest';
import { avisoBorrado, avisoCreado, leerDias, leerTipoNuevo, preguntaBorrar } from './tiposServicio';

// La tabla «Plazos por tipo de servicio» de Configuración (2026-11-24): los días de una casilla, la fila de crear un tipo y los
// textos de crear y borrar. La regla del nombre es la del servidor (errorNombreTipo); aquí se mira cómo la usa la pantalla.
const DIAS_MAL = 'Un número entero entre 1 y 365, o vacío.';

describe('días hábiles de una casilla', () => {
  it('un entero de 1 a 365, o vacío (sin plazo)', () => {
    expect(leerDias(' 5 ')).toEqual({ dias: 5 });
    expect(leerDias('1')).toEqual({ dias: 1 });
    expect(leerDias('365')).toEqual({ dias: 365 });
    expect(leerDias('  ')).toEqual({ dias: null });
  });

  it('fuera de rango, con decimales, negativo o con letras: el mensaje de siempre', () => {
    for (const t of ['0', '366', '1.5', '-1', 'tres']) expect(leerDias(t)).toEqual({ error: DIAS_MAL });
  });
});

describe('la fila de crear un tipo', () => {
  it('nombre y días que valen: se manda el nombre sin los espacios de los extremos; días vacíos = sin plazo', () => {
    expect(leerTipoNuevo('  Reparación  ', '5')).toEqual({ nuevo: { tipo: 'Reparación', dias: 5 }, errorNombre: null, errorDias: null });
    expect(leerTipoNuevo('Reparación', '')).toEqual({ nuevo: { tipo: 'Reparación', dias: null }, errorNombre: null, errorDias: null });
  });

  it('sin nombre no se manda nada, pero la fila vacía no sale en rojo', () => {
    expect(leerTipoNuevo('', '')).toEqual({ nuevo: null, errorNombre: null, errorDias: null });
    expect(leerTipoNuevo('   ', '5')).toEqual({ nuevo: null, errorNombre: null, errorDias: null });
  });

  it('el nombre, con la regla del servidor: sólo símbolos, más de 80 caracteres o un tipo compuesto', () => {
    expect(leerTipoNuevo('*', '')).toEqual({ nuevo: null, errorNombre: 'El nombre tiene que llevar al menos una letra o un número.', errorDias: null });
    expect(leerTipoNuevo('a'.repeat(81), '')).toMatchObject({ nuevo: null, errorNombre: 'El nombre no puede pasar de 80 caracteres.' });
    expect(leerTipoNuevo('Diagnóstico + Calibración', '7').errorNombre).toMatch(/es un tipo compuesto/);
  });

  it('unos días que no valen: no se manda, con el error en su casilla', () => {
    expect(leerTipoNuevo('Reparación', '0')).toEqual({ nuevo: null, errorNombre: null, errorDias: DIAS_MAL });
  });

  it('los textos de crear y borrar', () => {
    expect(avisoCreado('Reparación')).toBe('Tipo «Reparación» creado');
    expect(avisoBorrado('Reparación')).toBe('Tipo «Reparación» borrado');
    expect(preguntaBorrar('Reparación')).toBe('¿Borrar «Reparación»? También se borran sus días en la agenda.');
  });
});
