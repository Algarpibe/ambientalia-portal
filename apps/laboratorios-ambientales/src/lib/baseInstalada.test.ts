import { describe, it, expect } from 'vitest';
import type { Laboratorio } from '../types';
import { mapRecord } from '../services/api';
import type { EquipoInstalado } from './baseInstalada';
import {
  agruparEquipos,
  codigosEpa,
  esRegistroDeEquipoAire,
  esValorVacio,
  normalizarCodigosEpa,
  ordenarEquipos,
  separarSeries,
} from './baseInstalada';

describe('esValorVacio', () => {
  it('en blanco o solo espacios', () => {
    expect(esValorVacio('')).toBe(true);
    expect(esValorVacio('   ')).toBe(true);
  });

  it('solo guiones', () => {
    for (const valor of ['-', '---', ' -- ', '–', '—']) expect(esValorVacio(valor), valor).toBe(true);
  });

  it('«No aplica», «N/A» y «NA», sin distinguir mayúsculas', () => {
    for (const valor of ['No aplica', 'NO APLICA', 'No  Aplica', ' no aplica ', 'N/A', 'n/a', 'NA', 'na']) {
      expect(esValorVacio(valor), valor).toBe(true);
    }
  });

  it('un valor real no está vacío', () => {
    for (const valor of ['SN-0001', '0', 'NA-0001', 'Estación Ficticia Centro', '-12']) {
      expect(esValorVacio(valor), valor).toBe(false);
    }
  });
});

describe('separarSeries', () => {
  it('una sola serie, recortada', () => {
    expect(separarSeries('  SN-0001 ')).toEqual(['SN-0001']);
  });

  it('parte por comas, puntos y comas y saltos de línea', () => {
    expect(separarSeries('SN-0001, SN-0002;SN-0003\nSN-0004\r\nSN-0005')).toEqual([
      'SN-0001',
      'SN-0002',
      'SN-0003',
      'SN-0004',
      'SN-0005',
    ]);
  });

  it('no parte por «/» ni por espacios', () => {
    expect(separarSeries('XY-12345-678/2')).toEqual(['XY-12345-678/2']);
    expect(separarSeries('AB 1234')).toEqual(['AB 1234']);
  });

  it('parte por guion o «/» con espacio en al menos un lado', () => {
    expect(separarSeries('1001 - 1002  -  1003')).toEqual(['1001', '1002', '1003']);
    expect(separarSeries('2001 -2002')).toEqual(['2001', '2002']);
    expect(separarSeries('3001- 3002')).toEqual(['3001', '3002']);
    expect(separarSeries('4001 / 4002')).toEqual(['4001', '4002']);
    expect(separarSeries('5001 – 5002')).toEqual(['5001', '5002']);
    expect(separarSeries('5003 — 5004')).toEqual(['5003', '5004']);
    expect(separarSeries('SN-0001 (AB12) -  SN-0002 (AB12)')).toEqual(['SN-0001 (AB12)', 'SN-0002 (AB12)']);
  });

  it('guion y «/» pegados por los dos lados se quedan dentro de la serie', () => {
    expect(separarSeries('43c-00000-000/2')).toEqual(['43c-00000-000/2']);
  });

  it('descarta los trozos vacíos', () => {
    expect(separarSeries('SN-0001,, ;\n')).toEqual(['SN-0001']);
    expect(separarSeries('SN-0001, ---, No aplica')).toEqual(['SN-0001']);
    expect(separarSeries('')).toEqual([]);
    expect(separarSeries('---, No aplica')).toEqual([]);
  });
});

// Una fila con la forma real del dataset, pasada por mapRecord como en la app.
// El método cita un código real (RFPS-0202-141, Tisch / New Star); laboratorio,
// NIT, contacto, estación y serie son ficticios: el repo es público.
const RAW_AIRE = {
  c_digo_de_laboratorio: '201',
  estado_de_la_acreditaci_n: 'Activa',
  matriz: 'Aire',
  componente: 'Calidad del Aire',
  actividad: 'Muestreo',
  grupo: 'Contaminantes Criterio',
  variable: 'Material Particulado Menor a 10 micras',
  t_cnica: 'Gravimetría',
  m_todo: 'U.S. EPA CFR, Título 40, Parte 50, Apéndice J. Método de Referencia Manual RFPS-0202-141',
  rango_de_trabajo: '',
  nombre_del_laboratorio: 'LABORATORIO DE AIRE DEL NORTE S.A.S.',
  nit: '900.000.001-7',
  contacto: 'Contacto Ficticio Uno',
  ciudad: 'Bucaramanga',
  departamento: 'Santander',
  direcci_n: 'Calle 1 # 2-3',
  tel_fono: '6070000001',
  correo: 'aire.norte@example.com',
  actos_administrativos_que: '0001 del 2 de enero de 2023',
  desde: '2023-01-15T00:00:00.000',
  hasta: '2027-04-21T00:00:00.000',
  nombre_de_la_estaci_n: 'Estación Ficticia Centro',
  identificaci_n_de_equipo: 'SN-0001',
};

const fila = (over: Record<string, string> = {}): Laboratorio => mapRecord({ ...RAW_AIRE, ...over });

const TISCH = { marca: 'Tisch Environmental / New Star Environmental', modelo: 'TE-6070 / NS-6070' };
const GRIMM = { marca: 'Grimm', modelo: 'EDM180' };

// Un equipo ya armado, para probar el orden y los filtros sin pasar por
// agruparEquipos. Datos ficticios.
const equipo = (over: Partial<EquipoInstalado> = {}): EquipoInstalado => ({
  codigo: '201',
  laboratorio: 'LABORATORIO DE AIRE DEL NORTE S.A.S.',
  nit: '900.000.001-7',
  ciudad: 'Bucaramanga',
  departamento: 'Santander',
  contacto: '',
  telefono: '',
  correo: '',
  serie: 'SN-0001',
  estaciones: ['Estación Ficticia Centro'],
  marcasYModelos: [TISCH],
  codigosEpa: ['RFPS-0202-141'],
  variables: ['Material Particulado Menor a 10 micras'],
  vigenciaMasProxima: '2027-04-21',
  ...over,
});

const series = (lista: EquipoInstalado[]): string[] => lista.map((e) => e.serie);

describe('esRegistroDeEquipoAire', () => {
  it('entran calidad del aire y olores ofensivos, con cualquier grafía del dataset', () => {
    for (const componente of ['Calidad del Aire', 'Calidad de aire', 'Calidad del aire', 'Olores Ofensivos', 'Olores ofensivos']) {
      expect(esRegistroDeEquipoAire(fila({ componente })), componente).toBe(true);
    }
  });

  it('otros componentes del aire y otras matrices no entran', () => {
    for (const componente of ['Fuentes Fijas', 'Ruido Ambiental', 'Vibraciones']) {
      expect(esRegistroDeEquipoAire(fila({ componente })), componente).toBe(false);
    }
    expect(esRegistroDeEquipoAire(fila({ matriz: 'Agua' }))).toBe(false);
  });

  it('una acreditación suspendida no entra', () => {
    expect(esRegistroDeEquipoAire(fila({ estado_de_la_acreditaci_n: 'Suspendida' }))).toBe(false);
  });

  it('sin número de serie no entra', () => {
    for (const serie of ['', 'No aplica', 'N/A', '---', ' , ; ']) {
      expect(esRegistroDeEquipoAire(fila({ identificaci_n_de_equipo: serie })), serie).toBe(false);
    }
  });
});

describe('codigosEpa', () => {
  it('saca los códigos del método, sin repetir', () => {
    expect(codigosEpa('Método RFPS-0498-116 o RFPS-0498-117; ver RFPS-0498-116')).toEqual([
      'RFPS-0498-116',
      'RFPS-0498-117',
    ]);
  });

  it('los escribe con guiones aunque el dataset ponga espacios', () => {
    expect(codigosEpa('Apéndice L. EQPM 0311-195')).toEqual(['EQPM-0311-195']);
    expect(codigosEpa('Método de Referencia Manual\nRFPS- 0202-141')).toEqual(['RFPS-0202-141']);
    expect(codigosEpa('Manual:RFPS 0498-116')).toEqual(['RFPS-0498-116']);
  });

  it('la errata «RFNA-1289-0704» cuenta como RFNA-1289-070', () => {
    expect(codigosEpa('Apéndice F. RFNA-1289-0704')).toEqual(['RFNA-1289-070']);
  });

  it('un método sin código EPA no da ninguno', () => {
    expect(codigosEpa('SM 2320 B')).toEqual([]);
    expect(codigosEpa('Norma UNE-EN 16450')).toEqual([]);
    expect(codigosEpa('')).toEqual([]);
  });
});

describe('normalizarCodigosEpa', () => {
  it('pasa a guiones los códigos con espacios', () => {
    expect(normalizarCodigosEpa('Apéndice L. EQPM 0311-195')).toBe('Apéndice L. EQPM-0311-195');
    expect(normalizarCodigosEpa('RFPS- 0202-141')).toBe('RFPS-0202-141');
  });

  it('deja intacto el texto que no es un código EPA', () => {
    for (const texto of ['Método 5 - 10 ppm', 'NTC 3362 C', 'SM 2320 B', 'Norma UNE-EN 16450', '']) {
      expect(normalizarCodigosEpa(texto), texto).toBe(texto);
    }
  });
});

describe('agruparEquipos', () => {
  it('arma la ficha de un equipo a partir de su fila', () => {
    expect(agruparEquipos([fila()])).toEqual([
      {
        codigo: '201',
        laboratorio: 'LABORATORIO DE AIRE DEL NORTE S.A.S.',
        nit: '900.000.001-7',
        ciudad: 'Bucaramanga',
        departamento: 'Santander',
        contacto: 'Contacto Ficticio Uno',
        telefono: '6070000001',
        correo: 'aire.norte@example.com',
        serie: 'SN-0001',
        estaciones: ['Estación Ficticia Centro'],
        marcasYModelos: [TISCH],
        codigosEpa: ['RFPS-0202-141'],
        variables: ['Material Particulado Menor a 10 micras'],
        vigenciaMasProxima: '2027-04-21',
      },
    ]);
  });

  it('un analizador repetido en tres filas es un equipo con tres variables', () => {
    const metodo = 'Método de Referencia Automatizado RFNA-1194-099';
    const equipos = agruparEquipos([
      fila({ m_todo: metodo, identificaci_n_de_equipo: 'AN-0100', variable: 'Óxidos de Nitrógeno' }),
      fila({ m_todo: metodo, identificaci_n_de_equipo: 'AN-0100', variable: 'Dióxido de Nitrógeno' }),
      fila({ m_todo: metodo, identificaci_n_de_equipo: 'AN-0100', variable: 'Monóxido de Nitrógeno' }),
    ]);
    expect(equipos).toHaveLength(1);
    expect(equipos[0].variables).toEqual(['Dióxido de Nitrógeno', 'Monóxido de Nitrógeno', 'Óxidos de Nitrógeno']);
    expect(equipos[0].marcasYModelos).toEqual([{ marca: 'Teledyne API', modelo: '200E / T200 / N200 Series' }]);
  });

  it('la misma serie en dos laboratorios son dos equipos', () => {
    const equipos = agruparEquipos([
      fila({ c_digo_de_laboratorio: '201' }),
      fila({ c_digo_de_laboratorio: '202', nombre_del_laboratorio: 'LABORATORIO DEL SUR LTDA.' }),
    ]);
    expect(equipos.map((e) => [e.codigo, e.serie])).toEqual([
      ['201', 'SN-0001'],
      ['202', 'SN-0001'],
    ]);
  });

  it('una fila con varias series da un equipo por serie', () => {
    const equipos = agruparEquipos([fila({ identificaci_n_de_equipo: 'SN-0001, SN-0002;SN-0003\nSN-0004' })]);
    expect(series(equipos)).toEqual(['SN-0001', 'SN-0002', 'SN-0003', 'SN-0004']);
  });

  it('la serie se compara en mayúsculas y se queda con la primera grafía', () => {
    const equipos = agruparEquipos([
      fila({ identificaci_n_de_equipo: 'sn-0001' }),
      fila({ identificaci_n_de_equipo: 'SN-0001', variable: 'Partículas Suspendidas Totales' }),
    ]);
    expect(equipos).toHaveLength(1);
    expect(equipos[0].serie).toBe('sn-0001');
    expect(equipos[0].variables).toEqual(['Material Particulado Menor a 10 micras', 'Partículas Suspendidas Totales']);
  });

  it('las estaciones, distintas y ordenadas; sin ninguna, la lista va vacía («Sin estación»)', () => {
    const [conEstaciones, sinEstacion] = agruparEquipos([
      fila({ nombre_de_la_estaci_n: 'Estación Ficticia Sur' }),
      fila({ nombre_de_la_estaci_n: 'Estación Ficticia Centro' }),
      fila({ nombre_de_la_estaci_n: 'No aplica' }),
      fila({ identificaci_n_de_equipo: 'SN-0002', nombre_de_la_estaci_n: '---' }),
    ]);
    expect(conEstaciones.estaciones).toEqual(['Estación Ficticia Centro', 'Estación Ficticia Sur']);
    expect(sinEstacion.estaciones).toEqual([]);
  });

  it('un método sin código conocido deja el equipo sin marca («Sin identificar»), con su código EPA', () => {
    const [sinMarca] = agruparEquipos([fila({ m_todo: 'Método de Referencia Automatizado RFNA-1289-0704' })]);
    expect(sinMarca.marcasYModelos).toEqual([]);
    expect(sinMarca.codigosEpa).toEqual(['RFNA-1289-070']);
  });

  it('junta los pares distintos de marca y modelo, ordenados, y sus códigos', () => {
    const [conDosPares] = agruparEquipos([
      fila(),
      fila({ m_todo: 'Método Equivalente Automatizado EQPM-0311-195', variable: 'Material Particulado Menor a 2,5 micras' }),
      fila({ variable: 'Partículas Suspendidas Totales' }),
    ]);
    expect(conDosPares.marcasYModelos).toEqual([GRIMM, TISCH]);
    expect(conDosPares.codigosEpa).toEqual(['EQPM-0311-195', 'RFPS-0202-141']);
  });

  it('un código escrito con espacios también se identifica', () => {
    const [conEspacios] = agruparEquipos([fila({ m_todo: 'Método Equivalente Automatizado EQPM 0311-195' })]);
    expect(conEspacios.marcasYModelos).toEqual([GRIMM]);
    expect(conEspacios.codigosEpa).toEqual(['EQPM-0311-195']);
  });

  it('la vigencia más próxima es la fecha «hasta» más temprana; «---» no cuenta', () => {
    const [conFechas] = agruparEquipos([
      fila({ hasta: '2027-04-21T00:00:00.000' }),
      fila({ hasta: '2026-12-01T00:00:00.000' }),
      fila({ hasta: '---' }),
    ]);
    expect(conFechas.vigenciaMasProxima).toBe('2026-12-01');
    expect(agruparEquipos([fila({ hasta: '---' })])[0].vigenciaMasProxima).toBeNull();
  });

  it('cada dato de la ficha es el primero con valor: un «No aplica» no tapa el de otra fila', () => {
    const [ficha] = agruparEquipos([
      fila({ contacto: 'No aplica', tel_fono: '---' }),
      fila({ contacto: 'Contacto Ficticio Dos', tel_fono: '6070000002' }),
    ]);
    expect(ficha.contacto).toBe('Contacto Ficticio Dos');
    expect(ficha.telefono).toBe('6070000002');
  });

  it('sin código de laboratorio se agrupa por nombre', () => {
    const sinCodigo = { c_digo_de_laboratorio: '' };
    const mismoNombre = agruparEquipos([fila(sinCodigo), fila({ ...sinCodigo, variable: 'Partículas Suspendidas Totales' })]);
    expect(mismoNombre).toHaveLength(1);
    expect(mismoNombre[0].codigo).toBe('');
    const otroNombre = agruparEquipos([
      fila(sinCodigo),
      fila({ ...sinCodigo, nombre_del_laboratorio: 'LABORATORIO DEL SUR LTDA.' }),
    ]);
    expect(otroNombre).toHaveLength(2);
  });

  it('deja fuera lo que no es un equipo de aire', () => {
    expect(
      agruparEquipos([
        fila({ estado_de_la_acreditaci_n: 'Suspendida' }),
        fila({ componente: 'Fuentes Fijas' }),
        fila({ identificaci_n_de_equipo: 'No aplica' }),
      ]),
    ).toEqual([]);
  });
});

describe('ordenarEquipos', () => {
  it('por departamento, ciudad, laboratorio, estación y serie', () => {
    const ordenados = ordenarEquipos([
      equipo({ serie: 'F', laboratorio: 'Beta', estaciones: ['Norte'] }),
      equipo({ serie: 'D', laboratorio: 'Beta', estaciones: ['Centro'] }),
      equipo({ serie: 'E', laboratorio: 'Beta', estaciones: ['Norte'] }),
      equipo({ serie: 'C', laboratorio: 'Alfa' }),
      equipo({ serie: 'B', ciudad: 'Barrancabermeja' }),
      equipo({ serie: 'A', departamento: 'Antioquia', ciudad: 'Medellín' }),
    ]);
    expect(series(ordenados)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('«Sin estación» va al final de su laboratorio', () => {
    const ordenados = ordenarEquipos([
      equipo({ serie: 'X', estaciones: [] }),
      equipo({ serie: 'Y', estaciones: ['Zona Industrial'] }),
    ]);
    expect(series(ordenados)).toEqual(['Y', 'X']);
  });

  it('dos laboratorios con el mismo nombre no se mezclan: desempata el código', () => {
    const ordenados = ordenarEquipos([
      equipo({ serie: 'A', codigo: '202', estaciones: ['Centro'] }),
      equipo({ serie: 'B', codigo: '201', estaciones: ['Norte'] }),
      equipo({ serie: 'C', codigo: '202', estaciones: ['Norte'] }),
      equipo({ serie: 'D', codigo: '201', estaciones: ['Centro'] }),
    ]);
    expect(series(ordenados)).toEqual(['D', 'B', 'A', 'C']);
  });

  it('no toca la lista recibida', () => {
    const lista = [equipo({ serie: 'B' }), equipo({ serie: 'A' })];
    ordenarEquipos(lista);
    expect(series(lista)).toEqual(['B', 'A']);
  });
});
