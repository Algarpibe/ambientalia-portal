import { describe, it, expect } from 'vitest';
import type { Laboratorio } from '../types';
import { mapRecord } from '../services/api';
import { esGrasasYAceites, esInfrarrojo } from './prospects';

// Una fila con la forma real del dataset (como RAW en services/api.test.ts),
// pasada por mapRecord igual que en la app. Variable, técnica, método, matriz y
// fechas son valores reales de grasas y aceites (consultados el 2026-11-26); el
// laboratorio y su contacto son ficticios: el repo es público y son datos
// personales.
const RAW_GYA = {
  c_digo_de_laboratorio: '101',
  estado_de_la_acreditaci_n: 'Activa',
  matriz: 'Agua',
  componente: 'Continental',
  actividad: 'Análisis',
  grupo: 'Fisicoquímicos',
  variable: 'Aceites y Grasas',
  t_cnica: 'Gravimetría',
  m_todo: 'SM 5520 B',
  rango_de_trabajo: '5 mg/L - 1 000 mg/L',
  nombre_del_laboratorio: 'LABORATORIO ANDINO DE AGUAS S.A.S.',
  nit: '900.000.001-1',
  contacto: 'Contacto Ficticio Uno',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  direcci_n: 'Calle 1 # 2-3',
  tel_fono: '6040000001',
  correo: 'lab.andino@example.com',
  actos_administrativos_que: '0001 del 2 de enero de 2023',
  desde: '2023-01-15T00:00:00.000',
  hasta: '2027-04-21T00:00:00.000',
};

const fila = (over: Record<string, string> = {}): Laboratorio => mapRecord({ ...RAW_GYA, ...over });

describe('esGrasasYAceites', () => {
  it('reconoce las cuatro grafías de la variable', () => {
    for (const variable of ['Aceites y Grasas', 'Grasas y Aceites', 'Aceites y grasas', 'Grasas y aceites']) {
      expect(esGrasasYAceites(fila({ variable }))).toBe(true);
    }
  });

  it('no distingue mayúsculas ni espacios de más', () => {
    expect(esGrasasYAceites(fila({ variable: '  GRASAS  y   ACEITES ' }))).toBe(true);
  });

  it('vale para cualquier matriz', () => {
    for (const matriz of ['Agua', 'Suelo', 'Sedimento', 'Lodo']) {
      expect(esGrasasYAceites(fila({ matriz }))).toBe(true);
    }
  });

  it('una variable con «grasa» pero sin «aceite» queda fuera', () => {
    expect(esGrasasYAceites(fila({ variable: 'Grasas' }))).toBe(false);
  });

  it('otra variable queda fuera', () => {
    expect(esGrasasYAceites(fila({ variable: 'Alcalinidad' }))).toBe(false);
  });

  it('una acreditación Suspendida queda fuera', () => {
    expect(esGrasasYAceites(fila({ estado_de_la_acreditaci_n: 'Suspendida' }))).toBe(false);
  });
});

describe('esInfrarrojo', () => {
  it('la técnica «Fotometría» es infrarrojo', () => {
    expect(esInfrarrojo(fila({ t_cnica: 'Fotometría', m_todo: 'SM 5520 C' }))).toBe(true);
  });

  it('una técnica que dice «infrarrojo» también lo es', () => {
    expect(esInfrarrojo(fila({ t_cnica: 'Espectroscopía Infrarroja', m_todo: 'Método interno' }))).toBe(true);
  });

  it('la técnica «Gravimetría» no lo es', () => {
    expect(esInfrarrojo(fila({ t_cnica: 'Gravimetría', m_todo: 'SM 5520 D' }))).toBe(false);
  });

  it('si la técnica informa algo, manda ella y el método no se mira', () => {
    expect(esInfrarrojo(fila({ t_cnica: 'Gravimetría', m_todo: 'NTC 3362 C' }))).toBe(false);
  });

  it('técnica «---» con «NTC 3362 Métodos C, F»: el método dice infrarrojo', () => {
    expect(esInfrarrojo(fila({ t_cnica: '---', m_todo: 'NTC 3362 Métodos C, F' }))).toBe(true);
  });

  it('técnica «---» con «SM 5520 B»: no es infrarrojo', () => {
    expect(esInfrarrojo(fila({ t_cnica: '---', m_todo: 'SM 5520 B' }))).toBe(false);
  });

  it('con la técnica vacía, «---» o «No Aplica», todos los métodos por infrarrojo del dataset cuentan', () => {
    const metodos = [
      'SM 5520 C',
      'SM 5520 C, F',
      'NTC 3362 C',
      'NTC 3362 Método C',
      'NTC 3362 C Modificado',
      'NTC 3362 C, F',
      'ASTM D7066-04',
    ];
    for (const tecnica of ['', '---', 'No Aplica']) {
      for (const metodo of metodos) {
        expect(esInfrarrojo(fila({ t_cnica: tecnica, m_todo: metodo })), `${tecnica} / ${metodo}`).toBe(true);
      }
    }
  });

  it('los métodos gravimétricos del dataset no cuentan como infrarrojo', () => {
    const metodos = ['SM 5520 D', 'SM 5520 B, F', 'SM 5520 D, F', 'EPA 9071 B', 'EPA 9071 B, SM 5520 F Modificado'];
    for (const metodo of metodos) {
      expect(esInfrarrojo(fila({ t_cnica: '---', m_todo: metodo })), metodo).toBe(false);
    }
  });
});
