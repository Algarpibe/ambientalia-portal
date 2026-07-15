import { describe, it, expect } from 'vitest';
import type { Laboratorio } from '../types';
import { groupLabsByEquipment } from './brands';

const lab = (over: Partial<Laboratorio>): Laboratorio => ({
  codigo: '1', estado: 'Activa', matriz: 'Aire', componente: 'Calidad del Aire',
  actividad: 'Análisis', grupo: '', variable: 'PM10', tecnica: '', metodo: '',
  rango: '', nombreLaboratorio: 'Lab Uno', nit: '', contacto: 'Ana Ruiz',
  ciudad: 'Bogotá', departamento: 'Cundinamarca', direccion: '', telefono: '601',
  correo: 'ana@lab.co', actoAdministrativo: '', desde: '', hasta: '', ...over,
});

describe('groupLabsByEquipment', () => {
  it('solo cuenta acreditaciones activas de calidad del aire', () => {
    const data = [
      lab({ metodo: 'EQPM-0798-122' }),
      lab({ metodo: 'EQPM-0798-122', estado: 'Suspendida', nombreLaboratorio: 'Lab Suspendido' }),
      lab({ metodo: 'EQPM-0798-122', matriz: 'Agua', nombreLaboratorio: 'Lab Agua' }),
      lab({ metodo: 'EQPM-0798-122', componente: 'Fuentes Fijas', nombreLaboratorio: 'Lab Fijas' }),
    ];
    const res = groupLabsByEquipment(data, '', '');
    expect(res).toHaveLength(1);
    expect(res[0].nombreLaboratorio).toBe('Lab Uno');
  });

  it('descarta los registros cuyo método no mapea a ningún equipo', () => {
    expect(groupLabsByEquipment([lab({ metodo: 'SM 2320 B' })], '', '')).toHaveLength(0);
  });

  it('agrupa varios equipos bajo un mismo laboratorio', () => {
    const data = [lab({ metodo: 'EQPM-0798-122' }), lab({ metodo: 'EQSA-0495-100', variable: 'SO2' })];
    const res = groupLabsByEquipment(data, '', '');
    expect(res).toHaveLength(1);
    expect(res[0].equipos).toHaveLength(2);
  });

  it('no repite el mismo método dentro de un laboratorio', () => {
    const data = [lab({ metodo: 'EQPM-0798-122' }), lab({ metodo: 'EQPM-0798-122' })];
    expect(groupLabsByEquipment(data, '', '')[0].equipos).toHaveLength(1);
  });

  it('filtra por marca', () => {
    const data = [lab({ metodo: 'EQPM-0798-122' }), lab({ metodo: 'EQSA-0495-100' })];
    const res = groupLabsByEquipment(data, 'Teledyne API', '');
    expect(res[0].equipos).toHaveLength(1);
    expect(res[0].equipos[0].brand).toBe('Teledyne API');
  });

  it('filtra por marca y modelo a la vez', () => {
    const data = [lab({ metodo: 'EQSA-0495-100' }), lab({ metodo: 'RFCA-1093-093' })];
    const res = groupLabsByEquipment(data, 'Teledyne API', '300 Series');
    expect(res[0].equipos).toHaveLength(1);
    expect(res[0].equipos[0].model).toBe('300 Series');
  });

  it('omite los laboratorios que se quedan sin equipos tras filtrar', () => {
    expect(groupLabsByEquipment([lab({ metodo: 'EQPM-0798-122' })], 'Horiba', '')).toHaveLength(0);
  });

  it('descarta registros sin nombre de laboratorio', () => {
    expect(groupLabsByEquipment([lab({ metodo: 'EQPM-0798-122', nombreLaboratorio: '' })], '', '')).toHaveLength(0);
  });

  it('ordena los laboratorios por nombre y expone sus datos de contacto', () => {
    const data = [
      lab({ metodo: 'EQPM-0798-122', nombreLaboratorio: 'Zeta' }),
      lab({ metodo: 'EQPM-0798-122', nombreLaboratorio: 'Alfa' }),
    ];
    const res = groupLabsByEquipment(data, '', '');
    expect(res.map((l) => l.nombreLaboratorio)).toEqual(['Alfa', 'Zeta']);
    expect(res[0].contacto).toBe('Ana Ruiz');
    expect(res[0].correo).toBe('ana@lab.co');
  });
});
