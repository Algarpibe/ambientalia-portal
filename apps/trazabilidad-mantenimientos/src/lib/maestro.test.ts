import { describe, it, expect } from 'vitest';
import type { RecuentosMaestro, SincronizacionMaestro } from '../dominio';
import { hayQueAplicar, lineasPlan, textoCambio, textoUltima } from './maestro';

// Lo que enseña la tarjeta «Maestro de equipos · Desk 2.0» de Configuración:
// el plan del cruce en recuentos y la última sincronización. Datos ficticios.
const recuentos = (extra: Partial<RecuentosMaestro> = {}): RecuentosMaestro => ({
  maestro: 116, portal: 118, casan: 114, enlaces: 114, cambios: { cliente: 9, modelo: 0, serial: 2, activo: 1 }, altas: 2, soloPortal: 4, soloPortalActivos: 2,
  ambiguosMaestro: 0, ambiguosPortal: 0, sinSerial: 0, inactivos: 1, cambianDeCliente: 3, contactosSinEquipos: 1,
  ...extra,
});
const SIN_NADA = { enlaces: 0, altas: 0, cambios: { cliente: 0, modelo: 0, serial: 0, activo: 0 } };

describe('el plan en líneas', () => {
  it('todos los recuentos, en el orden en que se leen; lo que cambiaría algo va señalado', () => {
    expect(lineasPlan(recuentos()).map((l) => `${l.cambia ? '*' : ' '} ${l.texto}: ${l.valor}`)).toEqual([
      '  GRIMM EDM 180 en Desk 2.0: 116',
      '  Equipos en el inventario del portal: 118',
      '  Casan: 114',
      '* · se enlazan ahora con su equipo de Desk 2.0: 114',
      '* · les cambia el cliente: 9',
      '  · de ellos, cambian de cliente de verdad (no sólo cómo se escribe): 3',
      '  · les cambia el modelo: 0',
      '* · les cambia cómo se escribe el serial: 2',
      '* · cambian de activo a inactivo, o al revés: 1',
      '* Altas (sólo en Desk 2.0; nacen sin fecha de calibración): 2',
      '  Sólo en el portal (no se tocan): 4 (2 activos)',
      '  Ambiguos, con el serial repetido (no se tocan): 0 en Desk 2.0 · 0 en el portal',
      '  Inactivos en Desk 2.0: 1',
      '  Contactos puestos a mano que se quedarían sin equipos: 1',
    ]);
  });

  it('los equipos de Desk 2.0 sin serial válido sólo salen si hay alguno', () => {
    expect(lineasPlan(recuentos({ sinSerial: 2 })).map((l) => l.texto)).toContain('Sin serial válido en Desk 2.0 (no entran)');
  });

  it('ni un cliente ni un serial: sólo rótulos y números', () => {
    for (const l of lineasPlan(recuentos())) expect(l.valor).toMatch(/^\d+( \(\d+ activos\)| en Desk 2\.0 · \d+ en el portal)?$/);
  });
});

describe('¿hay algo que aplicar?', () => {
  it('sí con cualquier enlace, alta o cambio; no si el inventario ya está como el maestro', () => {
    expect(hayQueAplicar(recuentos())).toBe(true);
    expect(hayQueAplicar(recuentos(SIN_NADA))).toBe(false);
    expect(hayQueAplicar(recuentos({ ...SIN_NADA, altas: 1 }))).toBe(true);
    expect(hayQueAplicar(recuentos({ ...SIN_NADA, cambios: { ...SIN_NADA.cambios, activo: 1 } }))).toBe(true);
  });
});

describe('la última sincronización y el detalle', () => {
  const ultima: SincronizacionMaestro = { id: 4, huella: 'ab'.repeat(32), por: 'director@example.com', en: '2026-10-11 01:10:00+00', recuentos: recuentos() };

  it('quién, cuándo (en hora de Colombia) y qué aplicó', () => {
    expect(textoUltima(ultima)).toBe('director@example.com · 10/10/2026 20:10 · 114 enlazados, 12 cambios y 2 altas');
    expect(textoUltima({ ...ultima, recuentos: recuentos(SIN_NADA) })).toBe('director@example.com · 10/10/2026 20:10 · sin cambios');
  });

  it('cada cambio del detalle, en una línea', () => {
    expect(textoCambio({ clave: '18A00001', campo: 'cliente', antes: 'Cliente Ficticio A', despues: 'Cliente Ficticio B' })).toBe('cliente: «Cliente Ficticio A» → «Cliente Ficticio B»');
    expect(textoCambio({ clave: '18A00002', campo: 'activo', antes: 'sí', despues: 'no' })).toBe('activo: «sí» → «no»');
    expect(textoCambio({ clave: '18A00009', campo: 'alta', antes: null, despues: '18A00009 · Cliente Ficticio D' })).toBe('alta: 18A00009 · Cliente Ficticio D');
  });
});
