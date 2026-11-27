import { describe, it, expect } from 'vitest';
import type { Laboratorio } from '../types';
import { mapRecord } from '../services/api';
import type { CruceZoho } from './clientes';
import type { EquipoInstalado, FiltrosEquipos } from './baseInstalada';
import {
  FILTROS_VACIOS,
  SIN_IDENTIFICAR,
  agruparEquipos,
  codigosEpa,
  esRegistroDeEquipoAire,
  esValorVacio,
  filtrarEquipos,
  marcasDe,
  normalizarCodigosEpa,
  opcionesDeFiltro,
  ordenarEquipos,
  separarSeries,
  textoRecuento,
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
  id: 'codigo:201\nSN-0001',
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
        id: 'codigo:201\nSN-0001',
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

  it('el id es único por equipo y estable para la misma entrada', () => {
    const entrada = [
      fila({ c_digo_de_laboratorio: '201', identificaci_n_de_equipo: 'SN-0001' }),
      fila({ c_digo_de_laboratorio: '202', nombre_del_laboratorio: 'LABORATORIO DEL SUR LTDA.' }),
      fila({ c_digo_de_laboratorio: '201', identificaci_n_de_equipo: 'SN-0002' }),
      fila({ c_digo_de_laboratorio: '', nombre_del_laboratorio: 'LABORATORIO SIN CODIGO', identificaci_n_de_equipo: 'SN-0001' }),
      fila({ c_digo_de_laboratorio: 'N/A', nombre_del_laboratorio: 'OTRO SIN CODIGO', identificaci_n_de_equipo: 'SN-0001' }),
    ];
    const ids = agruparEquipos(entrada).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(agruparEquipos(entrada).map((e) => e.id)).toEqual(ids);
  });

  it('la misma serie en dos laboratorios tiene dos id distintos', () => {
    const [a, b] = agruparEquipos([
      fila({ c_digo_de_laboratorio: '201' }),
      fila({ c_digo_de_laboratorio: '202', nombre_del_laboratorio: 'LABORATORIO DEL SUR LTDA.' }),
    ]);
    expect(a.serie).toBe(b.serie);
    expect(a.id).not.toBe(b.id);
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

const HOY = '2026-11-27';

// Tres equipos ya armados: uno en el Valle con marca Teledyne; dos de un mismo
// NIT en Antioquia (dos sedes), uno sin marca ni estación. Datos ficticios.
const LISTA = [
  equipo({
    codigo: '1',
    serie: 'S1',
    laboratorio: 'LABORATORIO QUÍMICO DEL VALLE',
    nit: '900.111.222-3',
    departamento: 'Valle del Cauca',
    ciudad: 'Cali',
    estaciones: ['Estación Ficticia Norte'],
    marcasYModelos: [{ marca: 'Teledyne API', modelo: '100 Series' }],
  }),
  equipo({
    codigo: '2',
    serie: 'S2',
    laboratorio: 'Aire de Antioquia',
    nit: '800.333.444-5',
    departamento: 'Antioquia',
    ciudad: 'Medellín',
    estaciones: [],
    marcasYModelos: [],
  }),
  equipo({
    codigo: '3',
    serie: 'AB-778',
    laboratorio: 'Aire de Antioquia',
    nit: '800.333.444-5',
    departamento: 'Antioquia',
    ciudad: 'Rionegro',
    estaciones: ['Estación Ficticia Sur'],
  }),
];

const filtrar = (cambios: Partial<FiltrosEquipos>, cruce: CruceZoho | null = null): string[] =>
  series(filtrarEquipos(LISTA, { ...FILTROS_VACIOS, ...cambios }, cruce, HOY));

describe('filtrarEquipos', () => {
  it('sin filtros, todos, en el orden recibido', () => {
    expect(filtrar({})).toEqual(['S1', 'S2', 'AB-778']);
  });

  it('busca por nombre sin distinguir mayúsculas ni tildes', () => {
    expect(filtrar({ busqueda: 'quimico' })).toEqual(['S1']);
    expect(filtrar({ busqueda: '  AIRE de ANTIOQUÍA ' })).toEqual(['S2', 'AB-778']);
  });

  it('busca por NIT, con o sin puntos ni guion', () => {
    expect(filtrar({ busqueda: '900.111' })).toEqual(['S1']);
    expect(filtrar({ busqueda: '800333444' })).toEqual(['S2', 'AB-778']);
  });

  it('busca por estación', () => {
    expect(filtrar({ busqueda: 'ficticia sur' })).toEqual(['AB-778']);
  });

  it('busca por serie', () => {
    expect(filtrar({ busqueda: 'ab-778' })).toEqual(['AB-778']);
  });

  it('departamento y ciudad', () => {
    expect(filtrar({ departamento: 'Antioquia' })).toEqual(['S2', 'AB-778']);
    expect(filtrar({ departamento: 'Antioquia', ciudad: 'Rionegro' })).toEqual(['AB-778']);
  });

  it('marca: pasa si alguno de sus pares la tiene, también dentro de una marca con varios fabricantes', () => {
    expect(filtrar({ marca: 'Teledyne API' })).toEqual(['S1']);
    expect(filtrar({ marca: 'New Star Environmental' })).toEqual(['AB-778']);
  });

  it('marca «Sin identificar»: los que no tienen ningún par', () => {
    expect(filtrar({ marca: SIN_IDENTIFICAR })).toEqual(['S2']);
  });

  it('cliente: con el cruce filtra por estado; sin cruce no filtra', () => {
    const cruce: CruceZoho = new Map([
      ['900111222', { ultimaFactura: '2026-10-01', ocmaVendido: null, ultimosRepuestos: null }],
    ]);
    expect(filtrar({ cliente: 'activo' }, cruce)).toEqual(['S1']);
    expect(filtrar({ cliente: 'no-en-zoho' }, cruce)).toEqual(['S2', 'AB-778']);
    expect(filtrar({ cliente: 'activo' }, null)).toEqual(['S1', 'S2', 'AB-778']);
  });

  it('los filtros se suman', () => {
    expect(filtrar({ departamento: 'Antioquia', marca: SIN_IDENTIFICAR, busqueda: 'aire' })).toEqual(['S2']);
    expect(filtrar({ departamento: 'Valle del Cauca', busqueda: 'aire' })).toEqual([]);
  });
});

describe('marcasDe', () => {
  it('parte una marca con varios fabricantes; una sola queda igual', () => {
    expect(marcasDe('Tisch Environmental / New Star Environmental')).toEqual([
      'Tisch Environmental',
      'New Star Environmental',
    ]);
    expect(marcasDe('Met One Instruments, Inc.')).toEqual(['Met One Instruments, Inc.']);
  });

  it('una marca con «/» sin espacios queda entera', () => {
    expect(marcasDe('Marca A/B')).toEqual(['Marca A/B']);
  });

  it('una empresa con nombre viejo y nuevo es una sola opción', () => {
    expect(marcasDe('Environnement S.A. / ENVEA')).toEqual(['Environnement S.A. / ENVEA']);
    expect(marcasDe('BGI Inc. / Mesa Laboratories Inc.')).toEqual(['BGI Inc. / Mesa Laboratories Inc.']);
    expect(marcasDe('Graseby Andersen / Sierra-Andersen / General Metal Works')).toEqual([
      'Graseby Andersen / Sierra-Andersen / General Metal Works',
    ]);
  });

  it('dos fabricantes distintos siguen siendo dos opciones', () => {
    expect(marcasDe('Tisch Environmental / New Star Environmental')).toHaveLength(2);
  });

  it('un texto largo mezcla fabricantes sueltos y grupos', () => {
    expect(
      marcasDe('Teledyne Monitor Labs / Casella / Ecotech / Acoem / Aeris / Wedding & Associates'),
    ).toEqual(['Teledyne Monitor Labs', 'Casella', 'Ecotech / Acoem', 'Aeris', 'Wedding & Associates']);
  });
});

describe('marcas de una misma empresa', () => {
  const envea = equipo({ serie: 'E1', marcasYModelos: [{ marca: 'Environnement S.A. / ENVEA', modelo: 'AF22M' }] });
  const otro = equipo({ serie: 'E2', marcasYModelos: [{ marca: 'Tisch Environmental', modelo: 'TE-6070' }] });

  it('el filtro por el nombre del grupo pasa a los equipos de cualquiera de sus fabricantes', () => {
    const lista = [envea, otro];
    const filtros = { ...FILTROS_VACIOS, marca: 'Environnement S.A. / ENVEA' };
    expect(series(filtrarEquipos(lista, filtros, null, HOY))).toEqual(['E1']);
    // Un equipo cuya marca nombra solo uno de los dos también pasa.
    const solo = equipo({ serie: 'E3', marcasYModelos: [{ marca: 'ENVEA', modelo: 'X' }] });
    expect(series(filtrarEquipos([solo], filtros, null, HOY))).toEqual(['E3']);
  });

  it('las opciones traen el grupo una sola vez, aunque varios equipos lo nombren', () => {
    const otroEnvea = equipo({
      serie: 'E4',
      marcasYModelos: [{ marca: 'Environnement S.A. / ENVEA', modelo: 'MP101M' }],
    });
    expect(opcionesDeFiltro([envea, otroEnvea, otro], '').marcas).toEqual([
      'Environnement S.A. / ENVEA',
      'Tisch Environmental',
    ]);
  });

  it('un fabricante que sale en dos textos de marca se lista una vez', () => {
    const a = equipo({ marcasYModelos: [{ marca: 'Tisch Environmental / New Star Environmental', modelo: 'A' }] });
    const b = equipo({ marcasYModelos: [{ marca: 'Tisch Environmental', modelo: 'B' }] });
    expect(opcionesDeFiltro([a, b], '').marcas).toEqual(['New Star Environmental', 'Tisch Environmental']);
  });
});

describe('opcionesDeFiltro', () => {
  it('los departamentos de todos los equipos, distintos y ordenados', () => {
    expect(opcionesDeFiltro(LISTA, '').departamentos).toEqual(['Antioquia', 'Valle del Cauca']);
  });

  it('sin departamento, todas las ciudades; con uno, solo las suyas', () => {
    expect(opcionesDeFiltro(LISTA, '').ciudades).toEqual(['Cali', 'Medellín', 'Rionegro']);
    expect(opcionesDeFiltro(LISTA, 'Antioquia').ciudades).toEqual(['Medellín', 'Rionegro']);
  });

  it('las marcas presentes, partidas y ordenadas, con «Sin identificar» al final', () => {
    expect(opcionesDeFiltro(LISTA, '').marcas).toEqual([
      'New Star Environmental',
      'Teledyne API',
      'Tisch Environmental',
      'Sin identificar',
    ]);
  });

  it('si todos los equipos tienen marca, no ofrece «Sin identificar»', () => {
    expect(opcionesDeFiltro([LISTA[0]], '').marcas).toEqual(['Teledyne API']);
  });
});

describe('textoRecuento', () => {
  it('singular y plural', () => {
    expect(textoRecuento([])).toBe('0 equipos de 0 laboratorios');
    expect(textoRecuento([equipo()])).toBe('1 equipo de 1 laboratorio');
  });

  it('separa los miles al estilo es-CO', () => {
    const muchos = Array.from({ length: 1275 }, (_, i) => equipo({ serie: `S${i}` }));
    expect(textoRecuento(muchos)).toBe('1.275 equipos de 1 laboratorio');
  });

  it('cuenta los laboratorios por código, no los equipos', () => {
    expect(textoRecuento([equipo({ serie: 'A' }), equipo({ serie: 'B' }), equipo({ codigo: '202', serie: 'C' })])).toBe(
      '3 equipos de 2 laboratorios',
    );
  });
});
