import { describe, it, expect } from 'vitest';
import type { Laboratorio } from '../types';
import { mapRecord } from '../services/api';
import type { Prospecto } from './prospects';
import {
  clave,
  departamentosDe,
  esGrasasYAceites,
  esInfrarrojo,
  estadoVigencia,
  filterProspects,
  groupProspects,
  nitCoincide,
  sortProspects,
} from './prospects';

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
      // El dataset lo escribe con espacio («ASTM D 7066-04»); sin él también vale.
      'ASTM D 7066-04',
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

describe('estadoVigencia', () => {
  // Hoy + 6 meses = 2027-05-26.
  const HOY = '2026-11-26';

  it('sin fecha', () => {
    expect(estadoVigencia(null, HOY)).toBe('sin-fecha');
  });

  it('vencida: anterior a hoy', () => {
    expect(estadoVigencia('2026-11-25', HOY)).toBe('vencida');
  });

  it('el mismo día de hoy ya es «pronto», no «vencida» (borde de abajo)', () => {
    expect(estadoVigencia(HOY, HOY)).toBe('pronto');
  });

  it('«pronto» llega hasta la víspera de hoy + 6 meses', () => {
    expect(estadoVigencia('2027-05-25', HOY)).toBe('pronto');
  });

  it('hoy + 6 meses justo ya es «vigente»: el límite queda fuera (borde de arriba)', () => {
    expect(estadoVigencia('2027-05-26', HOY)).toBe('vigente');
  });

  it('más allá, «vigente»', () => {
    expect(estadoVigencia('2028-01-10', HOY)).toBe('vigente');
  });

  it('el límite se queda en el último día del mes: el 31 de agosto da el 28 de febrero', () => {
    expect(estadoVigencia('2027-02-27', '2026-08-31')).toBe('pronto');
    expect(estadoVigencia('2027-02-28', '2026-08-31')).toBe('vigente');
  });

  it('y en bisiesto, el 29 de febrero', () => {
    expect(estadoVigencia('2028-02-28', '2027-08-31')).toBe('pronto');
    expect(estadoVigencia('2028-02-29', '2027-08-31')).toBe('vigente');
  });
});

// Un prospecto ya armado, para probar el orden y los filtros sin pasar por
// groupProspects. Datos ficticios.
const prospecto = (over: Partial<Prospecto> = {}): Prospecto => ({
  codigo: '101',
  nombre: 'LABORATORIO ANDINO DE AGUAS S.A.S.',
  nit: '900.000.001-1',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  contacto: '',
  telefono: '',
  correo: '',
  matrices: ['Agua'],
  metodos: ['SM 5520 B'],
  grupo: 'gravimetria',
  vigenciaMasProxima: '2027-04-21',
  ...over,
});

const nombres = (lista: Prospecto[]): string[] => lista.map((p) => p.nombre);

describe('sortProspects', () => {
  it('de la vigencia más cercana a la más lejana, y los sin fecha al final', () => {
    const ordenados = sortProspects([
      prospecto({ nombre: 'Alfa', vigenciaMasProxima: null }),
      prospecto({ nombre: 'Beta', vigenciaMasProxima: '2028-01-10' }),
      prospecto({ nombre: 'Gamma', vigenciaMasProxima: '2026-12-01' }),
    ]);
    expect(nombres(ordenados)).toEqual(['Gamma', 'Beta', 'Alfa']);
  });

  it('a igual fecha, por nombre en español', () => {
    const ordenados = sortProspects([
      prospecto({ nombre: 'Centro' }),
      prospecto({ nombre: 'BIOLAB' }),
      prospecto({ nombre: 'Álamo' }),
    ]);
    expect(nombres(ordenados)).toEqual(['Álamo', 'BIOLAB', 'Centro']);
  });

  it('los sin fecha también se ordenan por nombre', () => {
    const ordenados = sortProspects([
      prospecto({ nombre: 'Zeta', vigenciaMasProxima: null }),
      prospecto({ nombre: 'Delta', vigenciaMasProxima: null }),
    ]);
    expect(nombres(ordenados)).toEqual(['Delta', 'Zeta']);
  });

  it('no toca la lista recibida', () => {
    const lista = [prospecto({ nombre: 'Beta' }), prospecto({ nombre: 'Alfa' })];
    sortProspects(lista);
    expect(nombres(lista)).toEqual(['Beta', 'Alfa']);
  });
});

describe('filterProspects', () => {
  const LISTA = [
    prospecto({ codigo: '1', nombre: 'LABORATORIO QUÍMICO DEL VALLE', nit: '900.111.222-3', departamento: 'Valle del Cauca', grupo: 'infrarrojo' }),
    prospecto({ codigo: '2', nombre: 'Aguas de Antioquia', nit: '800.333.444-5', departamento: 'Antioquia', grupo: 'infrarrojo' }),
    prospecto({ codigo: '3', nombre: 'Laboratorio Ambiental 2', nit: '901.222.000-1', departamento: 'Antioquia', grupo: 'gravimetria' }),
  ];
  const codigos = (lista: Prospecto[]): string[] => lista.map((p) => p.codigo);
  const filtrar = (grupo: Prospecto['grupo'], departamento: string, busqueda: string) =>
    codigos(filterProspects(LISTA, { grupo, departamento, busqueda }));

  it('se queda con el grupo de la pestaña', () => {
    expect(filtrar('infrarrojo', '', '')).toEqual(['1', '2']);
    expect(filtrar('gravimetria', '', '')).toEqual(['3']);
  });

  it('departamento vacío son todos; con valor, solo ese', () => {
    expect(filtrar('infrarrojo', 'Antioquia', '')).toEqual(['2']);
  });

  it('busca por nombre sin distinguir mayúsculas ni tildes', () => {
    expect(filtrar('infrarrojo', '', 'quimico')).toEqual(['1']);
    expect(filtrar('infrarrojo', '', '  AGUAS de ANTIOQUÍA ')).toEqual(['2']);
  });

  it('busca por NIT, con o sin puntos ni guion', () => {
    expect(filtrar('infrarrojo', '', '800.333')).toEqual(['2']);
    expect(filtrar('infrarrojo', '', '800333444')).toEqual(['2']);
    expect(filtrar('infrarrojo', '', '800333444-5')).toEqual(['2']);
  });

  it('las cifras de un nombre no casan con un NIT', () => {
    // Los NIT de 1 y 2 llevan un 2, pero «ambiental 2» no es un NIT.
    expect(filtrar('infrarrojo', '', 'ambiental 2')).toEqual([]);
  });

  it('la búsqueda y el departamento se suman', () => {
    expect(filtrar('infrarrojo', 'Antioquia', 'quimico')).toEqual([]);
  });
});

describe('departamentosDe', () => {
  it('los departamentos distintos, sin vacíos y ordenados', () => {
    const lista = [
      prospecto({ departamento: 'Valle del Cauca' }),
      prospecto({ departamento: 'Antioquia' }),
      prospecto({ departamento: '' }),
      prospecto({ departamento: 'Antioquia' }),
      prospecto({ departamento: 'Atlántico' }),
    ];
    expect(departamentosDe(lista)).toEqual(['Antioquia', 'Atlántico', 'Valle del Cauca']);
  });
});

// clave y nitCoincide los usa también la búsqueda de la Base instalada de aire.
describe('clave', () => {
  it('quita tildes y mayúsculas y colapsa los espacios', () => {
    expect(clave('  Estación   NÓRTE ')).toBe('estacion norte');
  });
});

describe('nitCoincide', () => {
  // `busqueda` llega ya pasada por clave, como en filterProspects.
  it('encuentra el NIT con su formato', () => {
    expect(nitCoincide('900.000.001-7', '900.000')).toBe(true);
  });

  it('y sin puntos ni guion', () => {
    expect(nitCoincide('900.000.001-7', '900000001')).toBe(true);
    expect(nitCoincide('900.000.001-7', '9000000017')).toBe(true);
  });

  it('las cifras dentro de un texto no son un NIT', () => {
    expect(nitCoincide('900.000.001-7', 'ambiental 1')).toBe(false);
    expect(nitCoincide('900.000.001-7', '900111')).toBe(false);
  });
});
