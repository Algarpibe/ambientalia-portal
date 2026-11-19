// Identidad del técnico: coincidencia de nombres normalizados. Nombres ficticios.
import { describe, expect, it } from 'vitest';
import type { Tablero, Tarjeta } from './nucleo';
import { coincideTecnico, esMia, tecnicosDelTablero } from './tecnico';

const tarjeta = (tecnico: Tarjeta['tecnico']): Tarjeta => ({
  clave: '1BA9041T|2026-11-01', sn: '18A90417', equipo: 'EDM180C', cliente: 'CLIENTE A', entrada: '2026-11-01', dias: 18, tono: 'verde',
  etiquetas: [], tecnico, ticket: '1001', pie: tecnico ? 'tecnico' : 'sin_asignar',
});
const deDesk = (nombre: string) => tarjeta({ nombre, iniciales: 'XX', avatar: 0 });
const delPortal = (nombre: string, userId: string) => tarjeta({ nombre, iniciales: 'XX', avatar: 0, userId });

describe('coincideTecnico', () => {
  it('ignora mayúsculas, tildes y espacios', () => {
    expect(coincideTecnico('María Pérez Gómez', ' maria   perez gomez ')).toBe(true);
  });
  it('acepta que el conjunto menor (2 o más palabras) esté dentro del mayor', () => {
    expect(coincideTecnico('María Pérez Gómez', 'Maria Perez')).toBe(true);
    expect(coincideTecnico('Maria Perez', 'María Pérez Gómez')).toBe(true);
  });
  it('rechaza una sola palabra, nombres distintos y vacíos', () => {
    expect(coincideTecnico('María Pérez Gómez', 'Maria')).toBe(false);
    expect(coincideTecnico('María Pérez Gómez', 'Carlos Ruiz')).toBe(false);
    expect(coincideTecnico('', '')).toBe(false);
  });
});

describe('esMia', () => {
  it('con asignación del portal, por la cuenta aunque el nombre no coincida', () => {
    expect(esMia(delPortal('Nombre En Cuenta', 'u-yo'), { userId: 'u-yo', nombre: 'Otro Nombre' })).toBe(true);
    expect(esMia(delPortal('Nombre En Cuenta', 'u-yo'), { userId: 'u-yo', nombre: null })).toBe(true);
  });
  it('si el portal la asignó a otra cuenta, no es tuya aunque el nombre coincida', () => {
    expect(esMia(delPortal('María Pérez Gómez', 'u-otro'), { userId: 'u-yo', nombre: 'María Pérez Gómez' })).toBe(false);
    expect(esMia(delPortal('María Pérez Gómez', 'u-otro'), { userId: null, nombre: 'María Pérez Gómez' })).toBe(false);
  });
  it('sin asignación del portal, como antes: el nombre frente al Encargado de Desk', () => {
    expect(esMia(deDesk('maria perez gomez'), { userId: 'u-yo', nombre: 'María Pérez Gómez' })).toBe(true);
    expect(esMia(deDesk('Técnico Dos'), { userId: 'u-yo', nombre: 'María Pérez Gómez' })).toBe(false);
    expect(esMia(deDesk('Técnico Dos'), { userId: 'u-yo', nombre: null })).toBe(false);
    expect(esMia(tarjeta(null), { userId: 'u-yo', nombre: 'María Pérez Gómez' })).toBe(false);
  });
});

describe('tecnicosDelTablero', () => {
  it('solo los nombres de Desk: las asignaciones del portal se reconocen por la cuenta, no por «¿Quién eres?»', () => {
    const t: Tablero = { kpis: [], columnas: [{ id: 'proceso', nombre: 'En proceso', descripcion: '', tarjetas: [deDesk('Técnico Uno'), delPortal('Técnico Dos', 'u2'), deDesk('TECNICO UNO')] }] };
    expect(tecnicosDelTablero(t)).toEqual(['Técnico Uno']);
  });
});
