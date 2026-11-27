import { describe, it, expect } from 'vitest';
import { lineasPase, mensajeParaPase, MENSAJE_PASE_MAX, nombreFicheroPase } from './pase';

describe('pase', () => {
  it('un mensaje corto queda igual y uno largo se recorta con puntos suspensivos', () => {
    expect(mensajeParaPase('¡Allá estaré!')).toBe('¡Allá estaré!');
    const largo = mensajeParaPase('a'.repeat(200));
    expect(largo).toHaveLength(MENSAJE_PASE_MAX);
    expect(largo.endsWith('…')).toBe(true);
  });

  it('el nombre del fichero no lleva tildes ni espacios', () => {
    expect(nombreFicheroPase('fin-de-ano-2026', 'José Peña Núñez')).toBe('Pase_fin-de-ano-2026_Jose_Pena_Nunez.png');
    expect(nombreFicheroPase('fin-de-ano-2026', '  ')).toBe('Pase_fin-de-ano-2026_invitado.png');
  });

  it('las líneas del pase llevan fecha, hora, lugar y menú', () => {
    expect(
      lineasPase({
        titulo: 'Almuerzo',
        nombre: 'Ana Ruiz',
        fecha: 'Viernes, 18 de diciembre de 2026',
        hora: '12:30 p. m.',
        lugar: 'Restaurante Anfitriona · Cl. 83 Bis #24-09',
        preferencia: 'Opción vegetariana',
        mensaje: null,
      }),
    ).toEqual([
      '📅 Viernes, 18 de diciembre de 2026 · 12:30 p. m.',
      '📍 Restaurante Anfitriona · Cl. 83 Bis #24-09',
      '🍽️ Preferencia: Opción vegetariana',
    ]);
  });
});
