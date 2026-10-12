import { describe, it, expect } from 'vitest';
import type { CambioMaestro, FilaHojaRevisar, RecuentosMaestro, RecuentosOtras, SincronizacionMaestro } from '../dominio';
import { bloquesDetalle, bloquesHoja, hayQueAplicar, hayQueAplicarOtras, lineasOtras, lineasPlan, textoCambio, textoFilaHoja, textoUltima } from './maestro';

// Lo que enseña la tarjeta «Maestro de equipos · Desk 2.0» de Configuración:
// el plan del cruce en recuentos y la última sincronización. Datos ficticios.
const recuentos = (extra: Partial<RecuentosMaestro> = {}): RecuentosMaestro => ({
  maestro: 116, portal: 118, casan: 114, enlaces: 114, cambios: { cliente: 9, modelo: 0, serial: 2, activo: 1 }, altas: 2, soloPortal: 4, soloPortalActivos: 2,
  ambiguosMaestro: 0, ambiguosPortal: 0, copiasInactivas: 2, sinSerial: 0, inactivos: 1, clienteOtroNombre: 3, contactosSinEquipos: 1,
  ...extra,
});
const SIN_NADA = { enlaces: 0, altas: 0, cambios: { cliente: 0, modelo: 0, serial: 0, activo: 0 } };

describe('el plan en líneas', () => {
  it('todos los recuentos, en el orden en que se leen; lo que cambiaría algo va señalado (*) y lo que pide mirarlo antes, resaltado (!)', () => {
    expect(lineasPlan(recuentos()).map((l) => `${l.aviso ? '!' : l.cambia ? '*' : ' '} ${l.texto}: ${l.valor}`)).toEqual([
      '  GRIMM EDM 180 en Desk 2.0: 116',
      '  Equipos en el inventario del portal: 118',
      '  Casan: 114',
      '* · se enlazan ahora con su equipo de Desk 2.0: 114',
      '* · les cambia el nombre del cliente: 9',
      '! · de ellos, con otro nombre (no sólo mayúsculas, tildes, puntuación o forma societaria: S.A.S., Ltda., BIC…): 3',
      '  · les cambia el modelo: 0',
      '* · les cambia cómo se escribe el serial: 2',
      '* · cambian de activo a inactivo, o al revés: 1',
      '! Altas (sólo en Desk 2.0; nacen sin fecha de calibración): 2',
      '  Sólo en el portal (no se tocan): 4 (2 activos)',
      '  Ambiguos, con el serial repetido (no se tocan): 0 en Desk 2.0 · 0 en el portal',
      '  Copias inactivas con el serial de otro equipo (no se tocan): 2',
      '  Inactivos en Desk 2.0: 1',
      '! Contactos puestos a mano que se quedarían sin equipos: 1',
    ]);
  });

  it('nada resalta a cero: ni los contactos, ni las altas, ni los de otro nombre', () => {
    const lineas = lineasPlan(recuentos({ altas: 0, clienteOtroNombre: 0, contactosSinEquipos: 0 }));
    expect(lineas.filter((l) => l.aviso)).toEqual([]);
  });

  it('el detalle se reparte en bloques: las altas primero, los clientes con otro nombre, los demás cambios y, aparte, los que sólo cambian de forma', () => {
    const c = (clave: string, campo: CambioMaestro['campo'], antes: string | null, despues: string): CambioMaestro => ({ clave, campo, antes, despues });
    const detalle = [
      c('18A00001', 'cliente', 'Cliente Ficticio A', 'Cliente Ficticio A S.A.S.'),
      c('18A00002', 'cliente', 'CFB', 'Cliente Ficticio Beta S.A.S. - CFB'),
      c('18A00002', 'serial', '18A00002', '18a00002'),
      c('18A00003', 'activo', 'sí', 'no'),
      c('PRUEBA-001', 'alta', null, 'PRUEBA-001 · Cliente Ficticio Z'),
    ];
    const b = bloquesDetalle(detalle);
    expect(b.altas.map((x) => x.clave)).toEqual(['PRUEBA-001']);
    expect(b.otroNombre.map((x) => x.clave)).toEqual(['18A00002']);
    expect(b.otros.map((x) => `${x.clave} ${x.campo}`)).toEqual(['18A00002 serial', '18A00003 activo']);
    expect(b.mismaForma.map((x) => x.clave)).toEqual(['18A00001']);
    expect(bloquesDetalle([])).toEqual({ altas: [], otroNombre: [], otros: [], mismaForma: [] });
  });

  it('los equipos de Desk 2.0 sin serial válido sólo salen si hay alguno', () => {
    expect(lineasPlan(recuentos({ sinSerial: 2 })).map((l) => l.texto)).toContain('Sin serial válido en Desk 2.0 (no entran)');
  });

  it('ni un cliente ni un serial: sólo rótulos y números', () => {
    for (const l of lineasPlan(recuentos())) expect(l.valor).toMatch(/^\d+( \(\d+ activos\)| en Desk 2\.0 · \d+ en el portal)?$/);
  });
});

// Lote 9d-2a: el segundo bloque del plan, las otras marcas (fuera de seguimiento), y el cruce con la hoja.
describe('otras marcas: el plan en líneas y lo que hay que revisar', () => {
  const otras = (extra: Partial<RecuentosOtras> = {}): RecuentosOtras => ({ maestro: 239, portal: 0, casan: 0, cambios: { cliente: 0, modelo: 0, serial: 0, activo: 0 }, altas: 237, soloPortal: 0, ambiguos: 2, sinSerial: 0, inactivos: 0, ...extra });

  it('sus recuentos, en el orden en que se leen: en azul lo que se escribiría, en ámbar lo que no entra y hay que mirar', () => {
    expect(lineasOtras(otras()).map((l) => `${l.aviso ? '!' : l.cambia ? '*' : ' '} ${l.texto}: ${l.valor}`)).toEqual([
      '  Equipos de otras marcas en Desk 2.0: 239',
      '  Ya enlazados en el portal (fuera de seguimiento): 0',
      '* Se enlazan ahora (altas fuera de seguimiento; sin fecha de calibración): 237',
      '  Cambios en los ya enlazados (cliente, modelo, serial o activo): 0',
      '! Con el serial repetido: no se enlazan, quedan para revisar: 2',
      '  Inactivos en Desk 2.0 (no se enlazan): 0',
      '  Ya no están en Desk 2.0 (no se tocan): 0',
    ]);
    const despues = lineasOtras(otras({ portal: 237, casan: 237, altas: 0, cambios: { cliente: 2, modelo: 1, serial: 0, activo: 1 }, sinSerial: 1, soloPortal: 3 }));
    expect(despues.find((l) => l.texto.startsWith('Cambios'))).toMatchObject({ valor: '4', cambia: true });
    expect(despues.map((l) => l.texto)).toContain('Sin serial válido en Desk 2.0 (no se enlazan)');
    expect(despues.find((l) => l.texto.startsWith('Ya no están'))).toMatchObject({ valor: '3', aviso: true });
    for (const l of lineasOtras(otras())) expect(l.valor).toMatch(/^\d+$/);
  });

  it('¿hay algo que aplicar? También si sólo cambian las otras marcas', () => {
    expect(hayQueAplicarOtras(otras())).toBe(true);
    expect(hayQueAplicarOtras(otras({ altas: 0 }))).toBe(false);
    expect(hayQueAplicarOtras(otras({ altas: 0, cambios: { cliente: 0, modelo: 0, serial: 1, activo: 0 } }))).toBe(true);
  });

  it('las filas de la hoja que no se enlazan, en bloques y cada una en una línea', () => {
    const f = (motivo: FilaHojaRevisar['motivo'], serial: string): FilaHojaRevisar => ({ motivo, marca: 'Horiba', serial, cliente: 'Cliente Ficticio H' });
    const b = bloquesHoja([f('repetido', 'HB-0002'), f('repetido', 'HB-0002'), f('sin_ceros', '123'), f('solo_hoja', 'TH-0001')]);
    expect([b.repetido.length, b.sin_ceros.length, b.solo_hoja.length]).toEqual([2, 1, 1]);
    expect(bloquesHoja([])).toEqual({ repetido: [], sin_ceros: [], solo_hoja: [] });
    expect(textoFilaHoja(f('sin_ceros', '123'))).toEqual(['Horiba · 123', 'Cliente Ficticio H']);
    expect(textoFilaHoja({ motivo: 'solo_hoja', marca: '', serial: '', cliente: '' })).toEqual(['(sin marca) · (sin serial)', '(sin cliente)']);
  });

  it('la última sincronización dice también lo que hizo con las otras marcas, si hizo algo; una de antes del lote se lee igual', () => {
    const ultima: SincronizacionMaestro = { id: 5, huella: 'ab'.repeat(32), por: 'director@example.com', en: '2026-10-11 01:10:00+00', recuentos: recuentos({ ...SIN_NADA, otras: otras() }) };
    expect(textoUltima(ultima)).toBe('director@example.com · 10/10/2026 20:10 · sin cambios en GRIMM EDM 180 · otras marcas: 237 enlazadas y 0 cambios');
    expect(textoUltima({ ...ultima, recuentos: recuentos({ otras: otras({ altas: 0 }) }) })).toBe('director@example.com · 10/10/2026 20:10 · 114 enlazados, 12 cambios y 2 altas');
    expect(textoUltima({ ...ultima, recuentos: recuentos({ ...SIN_NADA, otras: otras({ altas: 0 }) }) })).toBe('director@example.com · 10/10/2026 20:10 · sin cambios');
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
