import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RecuentosCalibraciones, SaludLectura } from './calibraciones.js';
import type { RecuentosMaestro, RecuentosOtras } from './maestro.js';
import { ACTOR_NOCTURNO, NUEVAS_MAX, decidirCalibraciones, decidirMaestro } from './pasadas-nocturnas.js';

// Las pasadas nocturnas (lote 10): la DECISIÓN, pura y sin base. Dados los recuentos del plan de esta noche (y,
// en el maestro, los de la última sincronización aplicada, para comparar los ambiguos), ¿se aplica sola o se
// retiene para que la mire una persona? Lo que retiene es lo que decidió Alfonso (y, marcado aquí, dos criterios
// prudentes más); lo que no escribe nada es «sin cambios» y ni siquiera se llama al aplicador.

const otras = (o: Partial<RecuentosOtras> = {}): RecuentosOtras => ({ maestro: 200, portal: 200, casan: 200, cambios: { cliente: 0, modelo: 0, serial: 0, activo: 0 }, altas: 0, soloPortal: 0, ambiguos: 3, sinSerial: 0, inactivos: 0, retiradosAMano: 0, ...o });
const maestro = (r: Partial<RecuentosMaestro> = {}): RecuentosMaestro => ({
  maestro: 118, portal: 118, casan: 116, enlaces: 0, cambios: { cliente: 0, modelo: 0, serial: 0, activo: 0 }, altas: 0, soloPortal: 2, soloPortalActivos: 1, ambiguosMaestro: 2, ambiguosPortal: 1,
  copiasInactivas: 0, sinSerial: 0, inactivos: 3, clienteOtroNombre: 0, contactosSinEquipos: 0, retiradosAMano: 0, ...r,
});
/** La última sincronización aplicada, con los mismos ambiguos que el plan de partida. */
const ULTIMA: RecuentosMaestro = { ...maestro(), otras: otras() };

describe('maestro: qué se aplica solo y qué se retiene', () => {
  it('un plan que no escribe nada es «sin cambios»: no se llama al aplicador (aunque haya pasivos: sólo en el portal, inactivos, retirados a mano)', () => {
    expect(decidirMaestro(maestro({ soloPortal: 5, inactivos: 9, retiradosAMano: 2, copiasInactivas: 1, sinSerial: 4 }), otras({ soloPortal: 3, inactivos: 7, sinSerial: 1 }), ULTIMA)).toEqual({ escribe: false, limpio: true, motivos: [] });
  });

  it('cambios de modelo, de cliente que sólo es otra forma de escribir el nombre y enlaces nuevos se aplican solos (también en las otras marcas)', () => {
    const d = decidirMaestro(maestro({ enlaces: 3, cambios: { cliente: 4, modelo: 2, serial: 0, activo: 0 }, clienteOtroNombre: 0 }), otras({ cambios: { cliente: 5, modelo: 1, serial: 0, activo: 0 } }), ULTIMA);
    expect(d).toEqual({ escribe: true, limpio: true, motivos: [] });
  });

  it.each([
    ['un alta de GRIMM EDM 180', maestro({ altas: 1 }), otras(), /Equipos nuevos que se darían de alta \(GRIMM EDM 180\): 1/],
    ['un cambio de serial', maestro({ cambios: { cliente: 0, modelo: 0, serial: 2, activo: 0 } }), otras(), /Cambios de serial \(GRIMM EDM 180\): 2/],
    ['un cambio de activo', maestro({ cambios: { cliente: 0, modelo: 0, serial: 0, activo: 1 } }), otras(), /Cambios de activo \/ inactivo \(GRIMM EDM 180\): 1/],
    ['un cliente con OTRO nombre', maestro({ cambios: { cliente: 1, modelo: 0, serial: 0, activo: 0 }, clienteOtroNombre: 1 }), otras(), /Clientes que pasarían a otro nombre \(no sólo otra forma de escribirlo\): 1/],
    ['un contacto puesto a mano que se queda sin equipos', maestro({ cambios: { cliente: 1, modelo: 0, serial: 0, activo: 0 }, contactosSinEquipos: 1 }), otras(), /Contactos puestos a mano que se quedarían sin equipos: 1/],
    ['más seriales repetidos en Desk 2.0', maestro({ enlaces: 1, ambiguosMaestro: 3 }), otras(), /Seriales repetidos en Desk 2\.0: 3 \(en la última sincronización aplicada, 2\)/],
    ['más seriales repetidos en el portal', maestro({ enlaces: 1, ambiguosPortal: 2 }), otras(), /Seriales repetidos en el portal: 2 \(en la última sincronización aplicada, 1\)/],
    ['un alta de otra marca', maestro(), otras({ altas: 4 }), /Otras marcas · equipos nuevos que se darían de alta: 4/],
    ['un cambio de serial en otra marca', maestro(), otras({ cambios: { cliente: 0, modelo: 0, serial: 1, activo: 0 } }), /Otras marcas · cambios de serial: 1/],
    ['un cambio de activo en otra marca', maestro(), otras({ cambios: { cliente: 0, modelo: 0, serial: 0, activo: 3 } }), /Otras marcas · cambios de activo \/ inactivo: 3/],
    ['más ambiguos en otras marcas', maestro(), otras({ altas: 0, cambios: { cliente: 1, modelo: 0, serial: 0, activo: 0 }, ambiguos: 5 }), /Otras marcas · seriales repetidos: 5 \(en la última sincronización aplicada, 3\)/],
  ])('RETIENE con %s', (_caso, r, o, motivo) => {
    const d = decidirMaestro(r, o, ULTIMA);
    expect(d.escribe).toBe(true);
    expect(d.limpio).toBe(false);
    expect(d.motivos.join('\n')).toMatch(motivo);
  });

  it('los ambiguos que BAJAN o se quedan igual no retienen', () => {
    expect(decidirMaestro(maestro({ enlaces: 1, ambiguosMaestro: 0, ambiguosPortal: 1 }), otras({ ambiguos: 1 }), ULTIMA)).toEqual({ escribe: true, limpio: true, motivos: [] });
  });

  it('sin ninguna sincronización aplicada antes, cualquier ambiguo retiene (no hay con qué comparar); una auditoría antigua sin `otras` cuenta como cero', () => {
    const d = decidirMaestro(maestro({ enlaces: 1 }), otras(), null);
    expect(d.limpio).toBe(false);
    expect(d.motivos).toEqual(['Seriales repetidos en Desk 2.0: 2 (ninguna sincronización aplicada antes)', 'Seriales repetidos en el portal: 1 (ninguna sincronización aplicada antes)', 'Otras marcas · seriales repetidos: 3 (ninguna sincronización aplicada antes)']);
    const antigua = { ...ULTIMA, otras: undefined };
    expect(decidirMaestro(maestro({ enlaces: 1 }), otras(), antigua).motivos).toEqual(['Otras marcas · seriales repetidos: 3 (en la última sincronización aplicada, 0)']);
  });

  it('un plan sin nada que escribir no se retiene aunque los ambiguos suban: no hay nada que aplicar (la próxima que escriba sí comparará)', () => {
    expect(decidirMaestro(maestro({ ambiguosMaestro: 9 }), otras(), ULTIMA)).toMatchObject({ escribe: false });
  });

  it('todos los motivos juntos, en orden y en español', () => {
    const d = decidirMaestro(maestro({ altas: 1, cambios: { cliente: 2, modelo: 0, serial: 1, activo: 1 }, clienteOtroNombre: 1, contactosSinEquipos: 1, ambiguosMaestro: 3, ambiguosPortal: 2 }), otras({ altas: 2, cambios: { cliente: 0, modelo: 0, serial: 1, activo: 1 }, ambiguos: 4 }), ULTIMA);
    expect(d.motivos).toHaveLength(11);
  });
});

const calib = (r: Partial<RecuentosCalibraciones> = {}): RecuentosCalibraciones => ({
  tickets: 800, conCf: 70, conCampo: 12, porNombre: 6, porEtiqueta: 6, gestionadosPorApp: 1, nuevas: 0, sinCambios: 12, cambiadas: 0, reenlazadas: 0, vaciadas: 0, enRevision: 0, otrasMarcas: 0,
  historial: 0, sinEquipo: 0, ilegibles: 0, noResucitan: 0, partida: 0, partidaDeInventario: 0, partidaDistintas: 0, equiposCambian: 0, salenDeAvisos: 0, entranEnAvisos: 0, ...r,
});
const SANA: SaludLectura = { alerta: false, bloquea: false, mensaje: null };

describe('calibraciones: qué se aplica solo y qué se retiene', () => {
  it('sin nada que escribir es «sin cambios», aunque haya pasivos (sin equipo, ilegibles, no resucitan, historial)', () => {
    expect(decidirCalibraciones(calib({ sinEquipo: 3, ilegibles: 2, noResucitan: 1, historial: 1 }), SANA)).toEqual({ escribe: false, limpio: true, motivos: [] });
  });

  it(`sólo nuevas, hasta ${30}, se aplican solas (también las de otras marcas y las que cambian equipos o avisos)`, () => {
    expect(NUEVAS_MAX).toBe(30);
    expect(decidirCalibraciones(calib({ nuevas: 30, otrasMarcas: 4, equiposCambian: 3, salenDeAvisos: 2, entranEnAvisos: 1 }), SANA)).toEqual({ escribe: true, limpio: true, motivos: [] });
  });

  it.each([
    ['más de 30 nuevas', calib({ nuevas: 31 }), SANA, /Calibraciones nuevas: 31 \(más de 30\)/],
    ['una fecha cambiada en Zoho', calib({ cambiadas: 1 }), SANA, /Fechas cambiadas en Zoho: 1/],
    ['un campo vaciado', calib({ vaciadas: 2 }), SANA, /Fechas vaciadas en Zoho \(se anularían\): 2/],
    ['una re-enlazada', calib({ reenlazadas: 1 }), SANA, /Re-enlazadas \(cambió su equipo o su revisión\): 1/],
    ['una en revisión', calib({ nuevas: 1, enRevision: 1 }), SANA, /En revisión \(fecha futura o imposible, o serial en dos equipos\): 1/],
    ['filas de punto de partida', calib({ partida: 2 }), SANA, /Filas de punto de partida nuevas: 2/],
    ['la salud avisa', calib({ nuevas: 1, conCampo: 0 }), { alerta: true, bloquea: false, mensaje: 'Ningún ticket de Desk 2.0 trae la «Fecha de Calibración».' }, /^Ningún ticket de Desk 2\.0 trae/],
    ['la salud bloquea', calib({ vaciadas: 5, conCampo: 0 }), { alerta: true, bloquea: true, mensaje: 'Ningún ticket … No se puede traer así.' }, /No se puede traer así/],
  ])('RETIENE con %s', (_caso, r, salud, motivo) => {
    const d = decidirCalibraciones(r, salud);
    expect(d.escribe).toBe(true);
    expect(d.limpio).toBe(false);
    expect(d.motivos.join('\n')).toMatch(motivo);
  });

  it('la salud sin mensaje tiene uno de reserva', () => {
    expect(decidirCalibraciones(calib({ nuevas: 1 }), { alerta: true, bloquea: false, mensaje: null }).motivos).toEqual(['La lectura de Desk 2.0 no trae ninguna «Fecha de Calibración».']);
  });
});

describe('CANDADO: la decisión es pura', () => {
  const src = readFileSync(fileURLToPath(new URL('./pasadas-nocturnas.ts', import.meta.url)), 'utf8');

  it('sólo importa tipos (la app la lee tal cual) y no mira el reloj ni la base', () => {
    const imports = [...src.matchAll(/^import (type )?.* from '([^']+)';\r?$/gm)].map((m) => `${m[1] ?? ''}${m[2]}`);
    expect(imports.sort()).toEqual(['type ./calibraciones.js', 'type ./maestro.js']);
    expect(src).not.toMatch(/Date\.now|new Date\(|\.query\(|setTimeout|setInterval/);
  });

  it('la firma de lo que aplica es «Pasada automática», sin id de usuario', () => {
    expect(ACTOR_NOCTURNO).toEqual({ userId: null, email: 'Pasada automática' });
  });
});
