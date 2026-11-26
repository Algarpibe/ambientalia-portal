import { describe, it, expect } from 'vitest';
import type { Laboratorio } from '../types';
import { mapRecord } from '../services/api';
import { esGrasasYAceites, esInfrarrojo, groupProspects } from './prospects';

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

describe('groupProspects', () => {
  it('arma la ficha de un laboratorio a partir de sus acreditaciones', () => {
    expect(groupProspects([fila()])).toEqual([
      {
        codigo: '101',
        nombre: 'LABORATORIO ANDINO DE AGUAS S.A.S.',
        nit: '900.000.001-1',
        ciudad: 'Medellín',
        departamento: 'Antioquia',
        contacto: 'Contacto Ficticio Uno',
        telefono: '6040000001',
        correo: 'lab.andino@example.com',
        matrices: ['Agua'],
        metodos: ['SM 5520 B'],
        grupo: 'gravimetria',
        vigenciaMasProxima: '2027-04-21',
      },
    ]);
  });

  it('solo cuentan sus acreditaciones activas de grasas y aceites', () => {
    const prospectos = groupProspects([
      fila({ variable: 'Alcalinidad', m_todo: 'SM 2320 B', hasta: '2026-12-01T00:00:00.000' }),
      fila({ estado_de_la_acreditaci_n: 'Suspendida', t_cnica: 'Fotometría', m_todo: 'SM 5520 C' }),
      fila(),
    ]);
    expect(prospectos).toHaveLength(1);
    expect(prospectos[0].metodos).toEqual(['SM 5520 B']);
    expect(prospectos[0].grupo).toBe('gravimetria');
    expect(prospectos[0].vigenciaMasProxima).toBe('2027-04-21');
  });

  it('un laboratorio sin acreditaciones de grasas y aceites no sale', () => {
    expect(groupProspects([fila({ variable: 'pH' })])).toEqual([]);
  });

  it('un laboratorio con las dos técnicas cuenta como infrarrojo', () => {
    const [prospecto] = groupProspects([
      fila({ t_cnica: 'Gravimetría', m_todo: 'SM 5520 B' }),
      fila({ t_cnica: 'Fotometría', m_todo: 'SM 5520 C' }),
    ]);
    expect(prospecto.grupo).toBe('infrarrojo');
    expect(prospecto.metodos).toEqual(['SM 5520 B', 'SM 5520 C']);
  });

  it('un mismo NIT con dos códigos son dos laboratorios', () => {
    const prospectos = groupProspects([
      fila({ c_digo_de_laboratorio: '101' }),
      fila({ c_digo_de_laboratorio: '102', ciudad: 'Rionegro' }),
    ]);
    expect(prospectos.map((p) => [p.codigo, p.nit, p.ciudad])).toEqual([
      ['101', '900.000.001-1', 'Medellín'],
      ['102', '900.000.001-1', 'Rionegro'],
    ]);
  });

  it('sin código, agrupa por nombre', () => {
    const prospectos = groupProspects([
      fila({ c_digo_de_laboratorio: '', m_todo: 'SM 5520 B' }),
      fila({ c_digo_de_laboratorio: '', m_todo: 'SM 5520 D' }),
      fila({ c_digo_de_laboratorio: '', nombre_del_laboratorio: 'LABORATORIO DEL LLANO LTDA.' }),
    ]);
    expect(prospectos.map((p) => [p.nombre, p.metodos])).toEqual([
      ['LABORATORIO ANDINO DE AGUAS S.A.S.', ['SM 5520 B', 'SM 5520 D']],
      ['LABORATORIO DEL LLANO LTDA.', ['SM 5520 B']],
    ]);
  });

  it('cada dato de la ficha es el primero no vacío, en el orden del dataset', () => {
    const [prospecto] = groupProspects([
      fila({ contacto: '', tel_fono: '' }),
      fila({ contacto: 'Contacto Ficticio Dos', tel_fono: '6040000002' }),
      fila({ contacto: 'Contacto Ficticio Tres', tel_fono: '6040000003' }),
    ]);
    expect(prospecto.contacto).toBe('Contacto Ficticio Dos');
    expect(prospecto.telefono).toBe('6040000002');
    expect(prospecto.correo).toBe('lab.andino@example.com');
  });

  it('junta matrices y métodos sin repetir y ordenados', () => {
    const [prospecto] = groupProspects([
      fila({ matriz: 'Suelo', m_todo: 'EPA 9071 B' }),
      fila({ matriz: 'Agua', m_todo: 'SM 5520 D' }),
      fila({ matriz: 'Agua', m_todo: 'SM 5520 B' }),
      fila({ matriz: 'Agua', m_todo: 'SM 5520 B' }),
    ]);
    expect(prospecto.matrices).toEqual(['Agua', 'Suelo']);
    expect(prospecto.metodos).toEqual(['EPA 9071 B', 'SM 5520 B', 'SM 5520 D']);
  });

  describe('vigencia más próxima', () => {
    it('es la más temprana de varias', () => {
      const [prospecto] = groupProspects([
        fila({ hasta: '2027-04-21T00:00:00.000' }),
        fila({ hasta: '2026-12-01T00:00:00.000' }),
        fila({ hasta: '2028-01-10T00:00:00.000' }),
      ]);
      expect(prospecto.vigenciaMasProxima).toBe('2026-12-01');
    });

    it('ignora «---»', () => {
      const [prospecto] = groupProspects([fila({ hasta: '---' }), fila({ hasta: '2027-04-21T00:00:00.000' })]);
      expect(prospecto.vigenciaMasProxima).toBe('2027-04-21');
    });

    it('si todas son «---», es null', () => {
      const [prospecto] = groupProspects([fila({ hasta: '---' }), fila({ hasta: '---' })]);
      expect(prospecto.vigenciaMasProxima).toBeNull();
    });
  });
});
