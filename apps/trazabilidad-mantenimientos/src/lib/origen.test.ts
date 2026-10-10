import { describe, it, expect } from 'vitest';
import { PROBLEMAS_FST022, type CongelacionFst022 } from '../dominio';
import { ETIQUETA_PROBLEMA, huellaCorta, lineasOrigen, textoOrigen, vigenteDe } from './origen';

// Lo que enseña la tarjeta «Origen de los datos» y la cabecera de la app: la
// F-ST-022 congelada, sólo en lectura (ya no se sube ninguna Excel). Datos
// ficticios con la forma de la congelación firmada: 6 columnas, cabecera en la fila 5.
const congelacion = (extra: Partial<CongelacionFst022> = {}): CongelacionFst022 => ({
  id: 2,
  archivo: 'F-ST-022 ficticia V3.xlsx',
  sha256: '2f097a30b157' + 'c'.repeat(52),
  hoja: 'Trazabilidad',
  vigente: true,
  motivo: null,
  por: 'director@example.com',
  en: '2026-10-10 15:04:00+00',
  reemplazadaPor: null,
  reemplazadaEn: null,
  reemplazadaMotivo: null,
  totalFilas: 371,
  totalColumnas: 6,
  filasGuardadas: 368,
  filaCabecera: 5,
  filasEquipo: 366,
  filasConSerial: 366,
  filasEdm180: 116,
  filasOtras: 2,
  problemas: { sin_serial: 0, sin_cliente: 0, serial_repetido: 6, serial_cientifico: 2, error_excel: 0, texto_en_fecha: 0, fecha_imposible: 0 },
  ...extra,
});

describe('vigenteDe', () => {
  it('la vigente de la lista, o null si no hay ninguna (o la lista aún no llegó)', () => {
    const anterior = congelacion({ id: 1, vigente: false });
    expect(vigenteDe([congelacion(), anterior])?.id).toBe(2);
    expect(vigenteDe([anterior])).toBeNull();
    expect(vigenteDe([])).toBeNull();
    expect(vigenteDe(null)).toBeNull();
  });
});

describe('textoOrigen: lo que dice la cabecera de la app', () => {
  it('la congelación vigente: cuándo (día en Colombia), desde qué archivo y quién', () => {
    expect(textoOrigen(congelacion())).toBe('F-ST-022 congelada el 10/10/2026 desde «F-ST-022 ficticia V3.xlsx» por director@example.com');
    // Las 02:00 UTC del día 11 son todavía el día 10 en Colombia.
    expect(textoOrigen(congelacion({ en: '2026-10-11 02:00:00+00' }))).toMatch(/congelada el 10\/10\/2026 /);
  });

  it('sin congelación no dice nada (ni rompe)', () => {
    expect(textoOrigen(null)).toBeNull();
  });
});

describe('lineasOrigen: los recuentos de la tarjeta', () => {
  it('tamaño, filas de equipo, GRIMM EDM 180, otras filas y sólo los avisos que tienen algo', () => {
    expect(lineasOrigen(congelacion())).toEqual([
      { texto: 'Tamaño de la hoja', valor: '371 filas × 6 columnas', aviso: false },
      { texto: 'Filas de equipo', valor: '366', aviso: false },
      { texto: '· con serial', valor: '366', aviso: false },
      { texto: '· GRIMM EDM 180', valor: '116', aviso: false },
      { texto: 'Otras filas (títulos, pie de totales, valores sueltos)', valor: '2', aviso: false },
      { texto: 'Con un serial que se repite', valor: '6', aviso: true },
      { texto: 'Con el serial numérico largo, que Excel muestra en notación científica', valor: '2', aviso: true },
    ]);
  });

  it('sin avisos, sólo los cinco recuentos; y no se cae si a `problemas` le falta una clave', () => {
    const sin = congelacion({ problemas: {} as CongelacionFst022['problemas'] });
    expect(lineasOrigen(sin).map((l) => l.aviso)).toEqual([false, false, false, false, false]);
  });
});

describe('textos', () => {
  it('cada tipo de aviso guardado tiene su rótulo, y el del serial numérico no afirma que el serial se perdiera', () => {
    expect(Object.keys(ETIQUETA_PROBLEMA).sort()).toEqual([...PROBLEMAS_FST022].sort());
    expect(ETIQUETA_PROBLEMA.serial_cientifico).not.toMatch(/perdi/i);
  });

  it('la huella abreviada: sus doce primeros caracteres', () => {
    expect(huellaCorta(congelacion().sha256)).toBe('sha256 2f097a30b157…');
  });
});
