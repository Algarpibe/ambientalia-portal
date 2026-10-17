import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import type { FilaCalibracion } from './calibraciones.js';
import { COLUMNAS_FST022, FILA_CABECERA, FORMULA_VIGENCIA, HOJAS_LIBRO, TIPO_XLSX, filasExportadas, libroFst022, nombreFichero, origenDeFecha } from './exportacion.js';
import type { Celda, FilaCongelada } from './fst022.js';
import { tablaHoja, type EquipoHoja, type RespuestaHoja, type Retiro } from './hoja.js';

// Exportar la F-ST-022 (lote 9e), sin base ni red: el generador puro que pasa la
// tabla de la pestaña (la MISMA regla, `tablaHoja`) a un libro .xlsx en memoria.
// Cada prueba LEE el fichero generado con SheetJS. Ningún .xlsx toca el disco.
// Clientes y seriales inventados (el repo es público).

const HOY = '2026-10-12';
/** La cabecera de la V3 tal como quedó congelada: los títulos y el orden que tiene que reproducir el libro. */
const CABECERAS: Celda[][] = [['Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Vigencia de Calibración (Dias)']];
const EXPORTA = { por: 'comercial@example.com', en: '2026-10-13T01:10:00Z' }; // las 20:10 del 12 en Colombia
const CONGELACION = { id: 7, archivo: 'F-ST-022 ficticia V3.xlsx', hoja: 'Trazabilidad', por: 'director@example.com', en: '2026-10-10 15:00:00+00' };
const RETIRO: Retiro = { por: 'director@example.com', en: '2026-10-12 15:00:00+00', motivo: 'El cliente lo dio de baja.' };

let n = 5;
const fila = (cliente: Celda, marca: Celda, modelo: Celda, serial: Celda, ultima: string | null, claveEquipo: string | null = null): FilaCongelada => ({ fila: ++n, celdas: [cliente, marca, modelo, serial, ultima ? { v: ultima, t: 'fecha' } : null, 357], esEquipo: true, serialNorm: String(serial ?? '').trim().toUpperCase() || null, claveEquipo });
const equipo = (clave: string, extra: Partial<EquipoHoja> = {}): EquipoHoja => ({ clave, serial: clave, cliente: 'Cliente Ficticio A S.A.S.', marca: 'GRIMM', modelo: 'EDM 180C', activo: true, ultimaCalibracion: null, ...extra });
let id = 0;
const cal = (clave: string | null, serial: string, f: string, extra: Partial<FilaCalibracion> = {}): FilaCalibracion => ({ id: ++id, clave, serial, deskEquipoId: null, fecha: f, origen: 'desk', ticket: 1000 + id, estado: 'vigente', corrigeTicket: null, corrigeFecha: null, anuladaAMano: false, ...extra });

interface Caso { filas?: FilaCongelada[]; equipos?: EquipoHoja[]; calibraciones?: FilaCalibracion[]; retiradas?: (Retiro & { fila: number })[]; congelacion?: RespuestaHoja['congelacion']; hoy?: string }
function respuesta({ filas = [], equipos = [], calibraciones = [], retiradas = [], congelacion = CONGELACION, hoy = HOY }: Caso): RespuestaHoja {
  return { hoy, congelacion, motivo: congelacion ? null : 'No hay hoja.', ...tablaHoja({ hoy, cabeceras: congelacion ? CABECERAS : [], filas, equipos, calibraciones, retiradas }) };
}
/** El libro generado, leído otra vez con SheetJS (con sus formatos de número y sus fórmulas). */
function leer(tabla: RespuestaHoja, exporta = EXPORTA) {
  const libro = libroFst022({ tabla, exporta });
  const wb = XLSX.read(libro.cuerpo, { type: 'buffer', cellNF: true });
  const celda = (hoja: string, ref: string): XLSX.CellObject | undefined => wb.Sheets[hoja][ref];
  const matriz = (hoja: string): unknown[][] => XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: true, defval: null });
  return { libro, wb, celda, matriz };
}
/** El día (AAAA-MM-DD) de una celda de fecha de Excel, sin pasar por la zona de la máquina. */
const dia = (c: XLSX.CellObject | undefined): string => XLSX.SSF.format('yyyy-mm-dd', c!.v as number);

describe('la hoja principal: las seis columnas de la V3, en su sitio', () => {
  const tabla = respuesta({ filas: [fila('Cliente Ficticio A', 'Thermo', '49i', 'TH-0001', '2026-03-01'), fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-0002', '2025-11-01')] });

  it('los títulos son los de la cabecera congelada, en su orden, y cambiarlos es tocar un solo sitio (COLUMNAS_FST022)', () => {
    expect(COLUMNAS_FST022.map((c) => c.titulo)).toEqual(CABECERAS[0]);
    expect(FILA_CABECERA).toBe(5);
  });

  it('el libro lleva cuatro hojas —la principal se llama como la congelada— con el bloque de título en las filas 1 a 3, la 4 vacía, la cabecera en la 5 y los datos desde la 6', () => {
    const { wb, matriz, celda } = leer(tabla);
    expect(wb.SheetNames).toEqual(['Trazabilidad', 'Retirados', 'Detalle', 'Notas']);
    expect([...HOJAS_LIBRO]).toEqual(wb.SheetNames);
    const m = matriz('Trazabilidad');
    expect(m[0][0]).toBe('F-ST-022 · Trazabilidad Mttos Clientes');
    expect(m[1][0]).toMatch(/^Exportado del portal el 12\/10\/2026 a las 20:10 \(hora de Colombia\) por comercial@example\.com/);
    expect(m[2][0]).toMatch(/^Punto de partida: hoja «Trazabilidad» congelada el 10\/10\/2026 desde «F-ST-022 ficticia V3\.xlsx»/);
    expect(m[3].every((v) => v === null)).toBe(true);
    expect(m[4]).toEqual(CABECERAS[0]);
    expect(m).toHaveLength(7);
    expect([m[5][0], m[6][0]]).toEqual(['Cliente Ficticio A', 'Cliente Ficticio B']);
    // Seis columnas y nada más a la derecha.
    expect(wb.Sheets.Trazabilidad['!ref']).toBe('A1:F7');
    expect(celda('Trazabilidad', 'G5')).toBeUndefined();
  });

  it('tipos de celda: cliente, marca, modelo y serial son TEXTO; la fecha es una FECHA de Excel (número con formato de fecha) y la vigencia, un número', () => {
    const { celda } = leer(tabla);
    for (const col of ['A', 'B', 'C', 'D']) expect(celda('Trazabilidad', `${col}6`)).toMatchObject({ t: 's' });
    const fecha = celda('Trazabilidad', 'E6')!;
    expect([fecha.t, fecha.z, fecha.w]).toEqual(['n', 'dd/mm/yyyy', '01/03/2026']);
    expect(dia(fecha)).toBe('2026-03-01');
    expect(celda('Trazabilidad', 'F6')).toMatchObject({ t: 'n', v: 140 });
  });

  it('la vigencia sigue «viva»: una fórmula por fila, la de la hoja (última calibración + 365 − HOY()), con su valor a la fecha de exportación en caché, igual al de la pestaña', () => {
    const { celda } = leer(tabla);
    expect(FORMULA_VIGENCIA(6)).toBe('E6-TODAY()+365');
    for (const [i, f] of tabla.filas.entries()) {
      const c = celda('Trazabilidad', `F${6 + i}`)!;
      expect([c.t, c.f, c.v]).toEqual(['n', `E${6 + i}-TODAY()+365`, f.vigenciaDias]);
    }
    expect(tabla.filas.map((f) => f.vigenciaDias)).toEqual([140, 20]);
  });

  it('una fecha AAAA-MM-DD es ESE día en cualquier zona: el número de serie se calcula sobre UTC, también en un 1 de enero y un 31 de diciembre', () => {
    const t = respuesta({ filas: [fila('Cliente Ficticio A', 'Thermo', '49i', 'TH-1', '2026-01-01'), fila('Cliente Ficticio A', 'Thermo', '49i', 'TH-2', '2025-12-31'), fila('Cliente Ficticio A', 'Thermo', '49i', 'TH-3', '2024-02-29')] });
    const { celda } = leer(t);
    expect(['E6', 'E7', 'E8'].map((r) => dia(celda('Trazabilidad', r)))).toEqual(['2026-01-01', '2025-12-31', '2024-02-29']);
    // 01/01/2026 es el día 46023 de Excel: un entero, sin hora.
    expect(celda('Trazabilidad', 'E6')!.v).toBe(46023);
    expect(fuente('./exportacion.ts')).not.toMatch(/\.get(Date|Hours|FullYear|Month|TimezoneOffset)\(|toLocale/);
  });

  it('sin fecha: la celda de la fecha y la de la vigencia van vacías (ni un cero ni una fórmula que dé un número absurdo)', () => {
    const { celda, matriz } = leer(respuesta({ filas: [fila('Cliente Ficticio G', 'Thermo', '49i', 'TH-0007', null)] }));
    expect(celda('Trazabilidad', 'E6')).toBeUndefined();
    expect(celda('Trazabilidad', 'F6')).toBeUndefined();
    expect(matriz('Trazabilidad')[5]).toEqual(['Cliente Ficticio G', 'Thermo', '49i', 'TH-0007', null, null]);
  });
});

describe('los seriales salen SIEMPRE como texto', () => {
  it('un serial numérico largo, o con ceros a la izquierda, queda íntegro: ni notación científica ni ceros perdidos', () => {
    const t = respuesta({
      filas: [fila('Cliente Ficticio D', 'HORIBA', 370, 18000000000001, '2024-03-01'), fila('Cliente Ficticio D', 'Horiba', 'APNA-370', '000123456789012345', '2025-12-01'), fila('Cliente Ficticio D', 'Horiba', 'APNA-370', '0042', null), fila('Cliente Ficticio D', 'Horiba', 'APNA-370', '1E5', null)],
    });
    const { celda } = leer(t);
    expect(['D6', 'D7', 'D8', 'D9'].map((r) => [celda('Trazabilidad', r)!.t, celda('Trazabilidad', r)!.v, celda('Trazabilidad', r)!.w])).toEqual([
      ['s', '18000000000001', '18000000000001'],
      ['s', '000123456789012345', '000123456789012345'],
      ['s', '0042', '0042'],
      ['s', '1E5', '1E5'],
    ]);
    // El modelo «370» de la hoja era un número: también sale como texto.
    expect(celda('Trazabilidad', 'C6')).toMatchObject({ t: 's', v: '370' });
  });
});

describe('caracteres raros e inyección de fórmulas', () => {
  const RAROS = ['=HYPERLINK("http://example.com","pulsa")', '+57 300 0000000', '-Cliente Ficticio', '@cliente', '=1+1', 'Ñandú & «Cía» "S.A.S." <ficticia>', "O'Higgins; coma, punto y coma", '\t=SUM(A1)'];

  it.each(RAROS)('un valor de texto como %j sale tal cual y como TEXTO: nunca como fórmula', (raro) => {
    const { celda, wb } = leer(respuesta({ filas: [fila(raro, raro, raro, 'TH-0001', '2026-03-01')] }));
    for (const col of ['A', 'B', 'C']) {
      const c = celda('Trazabilidad', `${col}6`)!;
      expect([c.t, c.v, c.f]).toEqual(['s', raro.trim(), undefined]);
    }
    // En todo el libro, las únicas fórmulas son las de la vigencia.
    const formulas = wb.SheetNames.flatMap((h) => Object.entries(wb.Sheets[h]).filter(([ref, c]) => !ref.startsWith('!') && (c as XLSX.CellObject).f !== undefined).map(([ref]) => `${h}!${ref}`));
    expect(formulas).toEqual(['Trazabilidad!F6']);
  });

  it('también en las otras hojas: el motivo de un retiro, quien exporta y el nombre del archivo congelado son texto aunque empiecen por =, +, - o @', () => {
    const f = fila('=Cliente', 'Thermo', '49i', '=SERIAL', '2026-03-01');
    const t = respuesta({ filas: [f], retiradas: [{ fila: f.fila, por: '=quien@example.com', en: RETIRO.en, motivo: '=2+2' }], congelacion: { ...CONGELACION, archivo: '=archivo.xlsx', por: '@quien' } });
    const { wb } = leer(t, { por: '+exporta@example.com', en: EXPORTA.en });
    const celdas = wb.SheetNames.flatMap((h) => Object.entries(wb.Sheets[h]).filter(([ref]) => !ref.startsWith('!')).map(([, c]) => c as XLSX.CellObject));
    expect(celdas.filter((c) => c.f !== undefined)).toEqual([]);
    for (const texto of ['=Cliente', '=SERIAL', '=quien@example.com', '=2+2', '+exporta@example.com']) expect(celdas.some((c) => c.t === 's' && c.v === texto), texto).toBe(true);
  });

  it('CANDADO: el generador sólo escribe una fórmula, la de la vigencia, y nunca arma una celda a partir de un texto con `aoa_to_sheet` ni lee un fichero', () => {
    const src = fuente('./exportacion.ts');
    expect(src.match(/[{,]\s*f:/g)).toHaveLength(1);
    expect(src).toMatch(/f: FORMULA_VIGENCIA\(/);
    expect(src).not.toMatch(/aoa_to_sheet|json_to_sheet|XLSX\.read|readFile|writeFile/);
  });
});

describe('qué filas salen y en qué orden', () => {
  const a = fila('Cliente Ficticio A', 'Grimm', 'EDM 180C', '18A00001', '2025-06-01', '18A00001');
  const b = fila('Cliente Ficticio B', 'Horiba', 'APNA-370', 'HB-0002', '2025-12-01');
  const c = fila('Cliente Ficticio C', 'Thermo', '49i', 'TH-0003', '2026-02-02');
  const d = fila('Cliente Ficticio D', 'Grimm', 'EDM 180C', '18A00004', '2025-01-01', '18A00004');
  const tabla = respuesta({
    filas: [c, a, d, b],
    equipos: [
      equipo('18A00001', { ultimaCalibracion: '2025-06-01' }),
      equipo('18A00004', { cliente: 'Cliente Ficticio D S.A.S.', activo: false, retirado: RETIRO }),
      equipo('18A00099', { cliente: 'Cliente Ficticio Z', ultimaCalibracion: '2026-05-05' }),
      equipo('KN-0001', { cliente: 'Cliente Ficticio Y', marca: 'Kunak', modelo: 'AIR Pro', enSeguimiento: false }),
      equipo('18A00098', { cliente: 'Cliente Ficticio X', activo: false, retirado: { ...RETIRO, motivo: 'Equipo de prueba.' } }),
    ],
    calibraciones: [cal('18A00001', '18A00001', '2026-09-20'), cal('18A00001', '18A00001', '2026-10-01', { origen: 'manual', ticket: null })],
    retiradas: [{ fila: b.fila, por: 'director@example.com', en: '2026-10-11 20:30:00+00', motivo: 'Fila duplicada.' }],
  });

  it('primero las filas de la hoja congelada, en su orden; después, lo que está en el inventario o en Desk 2.0 y no en la hoja; lo retirado a mano NO sale', () => {
    const { matriz } = leer(tabla);
    expect(matriz('Trazabilidad').slice(5).map((r) => [r[0], r[3]])).toEqual([
      ['Cliente Ficticio A S.A.S.', '18A00001'],
      ['Cliente Ficticio C', 'TH-0003'],
      ['Cliente Ficticio Y', 'KN-0001'],
      ['Cliente Ficticio Z', '18A00099'],
    ]);
    expect(filasExportadas(tabla).map((f) => f.serial)).toEqual(['18A00001', 'TH-0003', 'KN-0001', '18A00099']);
  });

  it('lo exportado es lo de la pestaña: los seis valores de cada fila son los de la tabla (cliente, marca, modelo y serial de HOY, la fecha de la regla y su vigencia)', () => {
    const { matriz, celda } = leer(tabla);
    const vivas = [...tabla.filas, ...tabla.fueraDeHoja].filter((f) => f.retirado === null);
    expect(vivas).toHaveLength(4);
    for (const [i, f] of vivas.entries()) {
      const r = matriz('Trazabilidad')[5 + i];
      expect(r.slice(0, 4)).toEqual([f.cliente, f.marca, f.modelo, f.serial]);
      const fecha = celda('Trazabilidad', `E${6 + i}`);
      expect(fecha ? dia(fecha) : null).toBe(f.ultimaCalibracion);
      expect(r[5]).toBe(f.vigenciaDias);
    }
    // La manual del 01/10 es la que cuenta en el primero: la fecha de la regla, no la de la hoja.
    expect(dia(celda('Trazabilidad', 'E6'))).toBe('2026-10-01');
  });

  it('«Retirados»: lo retirado a mano —equipos y filas de la hoja— con quién, cuándo (hora de Colombia) y motivo', () => {
    const { matriz, celda } = leer(tabla);
    const m = matriz('Retirados');
    expect(m[0]).toEqual(['Fila en la hoja congelada', 'Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Qué se retiró', 'Retirado por', 'Retirado el (hora de Colombia)', 'Motivo']);
    expect(m.slice(1).map((r) => [r[0], r[1], r[4], r[6], r[7], r[8], r[9]])).toEqual([
      [b.fila, 'Cliente Ficticio B', 'HB-0002', 'Fila de la hoja', 'director@example.com', '11/10/2026 15:30', 'Fila duplicada.'],
      [d.fila, 'Cliente Ficticio D S.A.S.', '18A00004', 'Equipo', 'director@example.com', '12/10/2026 10:00', 'El cliente lo dio de baja.'],
      [null, 'Cliente Ficticio X', '18A00098', 'Equipo', 'director@example.com', '12/10/2026 10:00', 'Equipo de prueba.'],
    ]);
    expect(celda('Retirados', 'E2')).toMatchObject({ t: 's' });
    expect(dia(celda('Retirados', 'F2'))).toBe('2025-12-01');
    expect(celda('Retirados', 'F3')).toBeUndefined();
  });

  it('«Detalle»: una línea por fila de la principal, en su mismo orden, con la fila de este libro, la de la hoja congelada, de dónde sale la fecha, cuándo vence y su estado', () => {
    const m = leer(tabla).matriz('Detalle');
    expect(m[0]).toEqual(['Fila en este libro', 'Fila en la hoja congelada', 'Serial', 'Origen de la fecha', 'Vence', 'Estado']);
    expect(m.slice(1).map((r) => [r[0], r[1], r[2], r[3], r[5]])).toEqual([
      [6, a.fila, '18A00001', 'Manual', 'Al día'],
      [7, c.fila, 'TH-0003', 'Hoja F-ST-022', 'Al día'],
      [8, null, 'KN-0001', 'Sin fecha', 'Sin fecha'],
      [9, null, '18A00099', 'Inventario del portal', 'Al día'],
    ]);
    expect(tabla.filas.map(origenDeFecha)).toEqual(['manual', 'fst022', 'fst022', 'sin_fecha']);
  });

  it('«Notas»: de qué congelación parte, cuándo (hora de Colombia) y quién exporta, los recuentos de lo exportado por marca y por estado, y qué significa cada origen de fecha', () => {
    const { matriz, libro } = leer(tabla);
    const notas = new Map(matriz('Notas').filter((r) => r[0] !== null).map((r) => [String(r[0]), r.slice(1)]));
    expect(notas.get('Exportado el (hora de Colombia)')![0]).toBe('12/10/2026 20:10');
    expect(notas.get('Exportado por')![0]).toBe('comercial@example.com');
    expect(notas.get('Valores a')![0]).toBe('12/10/2026');
    expect(notas.get('Punto de partida')![0]).toBe('Hoja «Trazabilidad» de «F-ST-022 ficticia V3.xlsx», congelada el 10/10/2026 por director@example.com (congelación n.º 7)');
    expect([notas.get('Filas exportadas')![0], notas.get('· de la hoja congelada')![0], notas.get('· del inventario o de Desk 2.0, fuera de la hoja')![0], notas.get('Retirados a mano (en su hoja, no en la principal)')![0]]).toEqual([4, 2, 2, 3]);
    expect([libro.filas, libro.retirados]).toEqual([4, 3]);
    expect(['GRIMM', 'Thermo', 'Kunak'].map((m) => notas.get(`Marca: ${m}`)![0])).toEqual([2, 1, 1]);
    expect([notas.get('Estado: Al día')![0], notas.get('Estado: Sin fecha')![0], notas.get('Estado: Vencida')![0]]).toEqual([3, 1, 0]);
    expect(['Hoja F-ST-022', 'Ticket de Desk 2.0', 'Manual', 'Inventario del portal', 'Sin fecha'].map((o) => notas.get(`Origen: ${o}`)![0])).toEqual([1, 0, 1, 1, 1]);
    for (const o of ['Hoja F-ST-022', 'Ticket de Desk 2.0', 'Manual', 'Inventario del portal', 'Sin fecha']) expect(String(notas.get(`Origen: ${o}`)![1])).toMatch(/.{20,}/);
    expect(String(notas.get('Vigencia')![0])).toMatch(/fórmula.*365.*HOY\(\)/);
  });
});

describe('sin congelación vigente', () => {
  it('se exporta igual lo que hay —los equipos del inventario y de Desk 2.0—, con la cabecera en su sitio, y el libro dice que no parte de ninguna hoja congelada', () => {
    const t = respuesta({ congelacion: null, equipos: [equipo('18A00001', { ultimaCalibracion: '2026-03-01' })] });
    const { matriz, wb, libro } = leer(t);
    expect(wb.SheetNames[0]).toBe('Trazabilidad');
    const m = matriz('Trazabilidad');
    expect(m[2][0]).toMatch(/^Sin F-ST-022 congelada en este entorno/);
    expect(m[4]).toEqual(CABECERAS[0]);
    expect(m.slice(5).map((r) => r[3])).toEqual(['18A00001']);
    expect(libro.filas).toBe(1);
    expect(matriz('Notas').find((r) => r[0] === 'Punto de partida')![1]).toMatch(/^Sin F-ST-022 congelada/);
  });

  it('sin nada que exportar el libro sigue siendo válido: sólo el título y la cabecera', () => {
    const { matriz, libro } = leer(respuesta({ congelacion: null }));
    expect(matriz('Trazabilidad')).toHaveLength(5);
    expect([libro.filas, libro.retirados]).toEqual([0, 0]);
  });
});

describe('el fichero', () => {
  it('se llama «F-ST-022 Trazabilidad Mttos Clientes AAAA-MM-DD.xlsx», con el día de los valores, y es un .xlsx de verdad', () => {
    expect(nombreFichero('2026-10-13')).toBe('F-ST-022 Trazabilidad Mttos Clientes 2026-10-13.xlsx');
    expect(TIPO_XLSX).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const { cuerpo, nombre } = libroFst022({ tabla: respuesta({}), exporta: EXPORTA });
    expect(nombre).toBe(`F-ST-022 Trazabilidad Mttos Clientes ${HOY}.xlsx`);
    expect(Buffer.isBuffer(cuerpo)).toBe(true);
    expect(cuerpo.subarray(0, 2).toString('latin1')).toBe('PK'); // un zip: xlsx, no el .xls binario de antes
  });

  it('es puro: misma entrada, mismas celdas; sin reloj, sin base y sin red (el instante de la exportación llega como argumento)', () => {
    const t = respuesta({ filas: [fila('Cliente Ficticio A', 'Thermo', '49i', 'TH-0001', '2026-03-01')] });
    const celdas = () => JSON.stringify(XLSX.read(libroFst022({ tabla: t, exporta: EXPORTA }).cuerpo, { type: 'buffer' }).Sheets);
    expect(celdas()).toBe(celdas());
    const src = fuente('./exportacion.ts');
    expect(src).not.toMatch(/Date\.now|new Date\(\)|hoyEnColombia|\bfetch\s*\(|\.query\(|from '\.\/(repo|hoja-repo)|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
  });
});

function fuente(f: string): string {
  return readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
}

describe('060_trazabilidad_exportaciones.sql', () => {
  const sinComentarios = fuente('../users/migrations/060_trazabilidad_exportaciones.sql').replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('sólo crea su tabla con IF NOT EXISTS: sin semilla, sin clave foránea y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias).toHaveLength(1);
    expect(sentencias[0]).toMatch(/^CREATE TABLE IF NOT EXISTS portal\.tmc_exportaciones \(/);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|SELECT|TRIGGER)\b/i);
    expect(sinComentarios).not.toMatch(/\bREFERENCES\b|\bdesk\.|tmc_fst022|tmc_equipos/i);
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|cola|programad|destinatari|email/i);
  });

  it('un apunte por exportación: quién, cuándo, a qué día, cuántas filas, de qué congelación y la huella del fichero; ni clientes ni seriales', () => {
    for (const columna of [/congelacion_id\s+BIGINT\s+NULL/, /hoy\s+DATE\s+NOT NULL/, /filas\s+INTEGER\s+NOT NULL/, /retirados\s+INTEGER\s+NOT NULL/, /archivo\s+VARCHAR\(120\)\s+NOT NULL/, /sha256\s+CHAR\(64\)\s+NOT NULL/, /por_id\s+UUID\s+NULL/, /por\s+VARCHAR\(254\)\s+NOT NULL/, /en\s+TIMESTAMPTZ\s+NOT NULL DEFAULT NOW\(\)/]) expect(sinComentarios).toMatch(columna);
    expect(sinComentarios).not.toMatch(/cliente|\bserial\b|marca|modelo/i); // BIGSERIAL es el tipo de su id
  });

  it('está apuntada en MIGRATIONS, detrás de la 059 (la última es la 061: marcas.test.ts)', () => {
    expect(fuente('../db.ts')).toMatch(/'059_trazabilidad_retiros\.sql',\s*'060_trazabilidad_exportaciones\.sql',/);
  });
});

describe('CANDADO: exportar sólo genera un fichero de salida', () => {
  const repo = fuente('./exportacion-repo.ts');

  it('lo único que escribe es su apunte: ni la congelación, ni el inventario, ni las calibraciones, ni los retiros', () => {
    const escrituras = [...repo.matchAll(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+([a-z_.0-9]+)/g)].map((m) => `${m[1].replace(/\s+/g, ' ')} ${m[2]}`);
    expect(escrituras).toEqual(['INSERT INTO portal.tmc_exportaciones']);
    expect(repo).not.toMatch(/tmc_equipos|tmc_calibraciones|tmc_retiros|tmc_seguimiento|tmc_contactos|db-desk2|getDesk2Pool|\bdesk\./);
  });

  it('la tabla sale de la MISMA lectura que la pestaña (`leerHoja`): no hay una segunda regla ni un segundo SQL de la hoja', () => {
    expect(repo).toMatch(/import \{ leerHoja \} from '\.\/hoja-repo\.js'/);
    expect(repo).toMatch(/await leerHoja\(db, hoy\)/);
    expect(repo).not.toMatch(/tablaHoja|tmc_fst022_congelada/);
    expect(fuente('./exportacion.ts')).not.toMatch(/tablaHoja|calibracionQueCuenta|fechaEfectiva|estadoCalibracion/);
  });

  it('NINGÚN CORREO, ningún programador y NINGUNA subida: ni el generador ni su SQL envían nada, ni aceptan un fichero o un cuerpo', () => {
    for (const src of [repo, fuente('./exportacion.ts')]) {
      expect(src).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
      expect(src).not.toMatch(/XLSX\.read|multer|req\.body|\.(matriz)\b|parseImportacion|parseCongelacion/);
    }
    for (const f of ['./fuente.ts', './registro-estados.ts', '../index.ts']) expect(fuente(f), f).not.toMatch(/exportacion|libroFst022|tmc_exportaciones/);
  });
});
