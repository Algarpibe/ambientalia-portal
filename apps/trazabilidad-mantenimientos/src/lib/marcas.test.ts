import { describe, it, expect } from 'vitest';
import type { EquipoVista, MarcaSeguimiento, ResumenMarca } from '../dominio';
import { efectoMarca, efectoVigencia, filtrarPorMarca, lineasVistaPrevia, lineasVistaVigencia, marcasDeEquipos, textoCambioMarca, textoCambioVigencia, textoDias, textoMarcas, textoVigencias, vigenciaElegida } from './marcas';

// Lo que calcula la tarjeta «Marcas en seguimiento» (lote 9f), la cabecera y el
// filtro de marca de «Equipos». Sólo recuentos y textos: nada de esto envía nada.

const VACIO: ResumenMarca = { equipos: 0, porEstado: { FUERA_CICLO: 0, VENCIDA: 0, VENCE_30: 0, VENCE_60: 0, VENCE_90: 0, AL_DIA: 0, SIN_VENCIMIENTO: 0, SIN_FECHA: 0 }, avisos: 0, clientesAvisos: 0, partidas: 0, enlazadas: 0, fechas: [] };
/** Con 365 días salvo que se diga otra cosa (GRIMM EDM 180, fija). */
const marca = (clave: string, nombre: string, incluida: boolean, resumen: Partial<ResumenMarca> = {}, dias: number | null = 365): MarcaSeguimiento => ({
  clave, marca: nombre, fija: clave === 'grimm edm 180', incluida, firma: null, vigencia: { dias, fija: clave === 'grimm edm 180', porDefecto: true, firma: null }, resumen: { ...VACIO, ...resumen },
});
const HORIBA = marca('horiba', 'Horiba', false, { equipos: 230, avisos: 24, clientesAvisos: 11, porEstado: { ...VACIO.porEstado, VENCIDA: 24, FUERA_CICLO: 126, SIN_FECHA: 29, AL_DIA: 51 }, partidas: 201, enlazadas: 9 });

describe('la cabecera', () => {
  it('dice las marcas incluidas, GRIMM EDM 180 delante; sin la lista, la de siempre', () => {
    expect(textoMarcas(null)).toBe('GRIMM EDM 180');
    expect(textoMarcas([marca('grimm edm 180', 'GRIMM EDM 180', true), HORIBA])).toBe('GRIMM EDM 180');
    expect(textoMarcas([marca('grimm edm 180', 'GRIMM EDM 180', true), { ...HORIBA, incluida: true }, marca('grimm', 'GRIMM (otros modelos)', true)])).toBe('GRIMM EDM 180 + Horiba + GRIMM (otros modelos)');
  });
});

describe('la vista previa de encender o apagar una marca', () => {
  it('encender: cuántos entran, cuántos en avisos y de cuántos clientes, los que no piden aviso (+1 año, sin fecha) y lo que se escribe', () => {
    expect(lineasVistaPrevia(HORIBA)).toEqual([
      { texto: 'Equipos que entran en Resumen, Equipos, Calendario y Avisos', valor: 230, cambia: true },
      { texto: 'De ellos, entran en «Avisos a clientes» (vencidas o por vencer)', valor: 24, aviso: true },
      { texto: '· de clientes distintos', valor: 11 },
      { texto: 'Vencidas hace más de un año (no piden aviso)', valor: 126 },
      { texto: 'Sin fecha (no piden aviso)', valor: 29 },
      { texto: 'Al día', valor: 51 },
      { texto: 'Filas de partida que nacen (la fecha de la hoja, guardada con su equipo)', valor: 201 },
      { texto: 'Calibraciones sueltas que se enlazan con su equipo', valor: 9 },
    ]);
    expect(efectoMarca(HORIBA)).toMatch(/^Sus 230 equipos activos entran en Resumen, Equipos, Calendario y Avisos con la misma fecha de calibración que hoy enseña la pestaña «Trazabilidad F-ST-022»\. No se envía ningún correo/);
  });

  it('apagar: cuántos salen y cuántos dejan los avisos; se dice que nada se borra y que se puede volver a encender', () => {
    const encendida = { ...HORIBA, incluida: true };
    expect(lineasVistaPrevia(encendida).map((l) => [l.texto, l.valor])).toEqual([
      ['Equipos que salen de Resumen, Equipos, Calendario y Avisos', 230],
      ['De ellos, salen de «Avisos a clientes»', 24],
      ['· de clientes distintos', 11],
    ]);
    expect(efectoMarca(encendida)).toMatch(/nada se borra.*se puede volver a encender/i);
  });

  it('el apunte de un cambio, en una línea', () => {
    expect(textoCambioMarca({ id: 1, clave: 'horiba', marca: 'Horiba', accion: 'incluir', motivo: 'Decisión ficticia.', equipos: 230, partidas: 201, enlazadas: 9, por: 'director@example.com', en: '2026-10-17 20:00:00+00' })).toBe('Horiba encendida por director@example.com el 17/10/2026 15:00 (230 equipos; 201 partidas y 9 enlazadas): Decisión ficticia.');
    expect(textoCambioMarca({ id: 2, clave: 'horiba', marca: 'Horiba', accion: 'excluir', motivo: 'Vuelta atrás.', equipos: 230, partidas: 0, enlazadas: 0, por: 'director@example.com', en: '2026-10-18 20:00:00+00' })).toBe('Horiba apagada por director@example.com el 18/10/2026 15:00 (230 equipos): Vuelta atrás.');
  });
});

// Lote 11: la vigencia de calibración por marca. GRIMM, 365 días (12 meses); Horiba y las demás, sin vencimiento hasta que alguien con
// `inventario.write` les ponga un plazo. En pantalla se entiende en meses; la vista previa dice cuántos equipos entrarían o saldrían de
// «Avisos a clientes» con la fecha que ya tienen (las cuenta aquí, con la misma regla del servidor, sobre las fechas que manda GET /marcas).
describe('la vigencia de una marca', () => {
  const HOY = '2026-10-17';
  // Horiba: una vence en días con 365 (2025-10-22), una vencida en el último año (2025-08-01), una +1 año (2024-02-02) y una al día.
  const fechas = ['2024-02-02', '2025-08-01', '2025-10-22', '2026-06-30'];
  const horiba = (incluida: boolean, dias: number | null) => marca('horiba', 'Horiba', incluida, { equipos: 5, fechas, porEstado: { ...VACIO.porEstado, SIN_FECHA: 1 } }, dias);

  it('se lee en días y en meses; sin plazo, «sin vencimiento»', () => {
    expect([365, 730, 1095, 30, 90, 182, 180, 45].map(textoDias)).toEqual(['365 días (12 meses)', '730 días (24 meses)', '1095 días (36 meses)', '30 días (1 mes)', '90 días (3 meses)', '182 días (6 meses)', '180 días (unos 6 meses)', '45 días (unos 1,5 meses)']);
    expect(textoDias(null)).toBe('sin vencimiento');
  });

  it('la cabecera dice la vigencia de cada marca incluida, agrupada; sin la lista, la de GRIMM', () => {
    expect(textoVigencias(null)).toBe('vigencia de calibración: 12 meses');
    expect(textoVigencias([marca('grimm edm 180', 'GRIMM EDM 180', true), horiba(false, null)])).toBe('vigencia de calibración: 12 meses');
    expect(textoVigencias([marca('grimm edm 180', 'GRIMM EDM 180', true), horiba(true, null), marca('grimm', 'GRIMM (otros modelos)', true), marca('kunak', 'Kunak', true, {}, 730)])).toBe(
      'vigencia de calibración: GRIMM EDM 180 y GRIMM (otros modelos), 12 meses; Horiba, sin vencimiento; Kunak, 24 meses',
    );
  });

  it('lo que se elige en el formulario: «sin vencimiento» o un número entero de días de 30 a 1095; lo demás no vale (undefined)', () => {
    expect(vigenciaElegida('sin', '')).toBeNull();
    expect(vigenciaElegida('sin', 'cualquier cosa')).toBeNull();
    expect(['365', ' 730 ', '30', '1095'].map((t) => vigenciaElegida('dias', t))).toEqual([365, 730, 30, 1095]);
    for (const t of ['', '29', '1096', '365.5', '12 meses', '-365']) expect(vigenciaElegida('dias', t), t).toBeUndefined();
  });

  it('vista previa de ponerle 365 días a una marca INCLUIDA sin vencimiento: cuántos entran en avisos (y de ellos, cuántos ya vencidos) y cuántos +1 año', () => {
    expect(lineasVistaVigencia(horiba(true, null), 365, HOY)).toEqual([
      { texto: 'Vigencia', valor: 'sin vencimiento → 365 días (12 meses)', cambia: true },
      { texto: 'Equipos activos de la marca con fecha de calibración', valor: '4' },
      { texto: 'Entran en «Avisos a clientes» (vencidas o por vencer)', valor: '2', aviso: true },
      { texto: 'Salen de «Avisos a clientes»', valor: '0' },
      { texto: 'Vencidas hace más de un año (no piden aviso)', valor: '1' },
      { texto: 'Sin fecha (no vencen ni avisan)', valor: '1' },
    ]);
  });

  it('vista previa de volver a «sin vencimiento»: salen los que estaban en avisos; con una marca APAGADA se dice que Avisos no cambia hasta encenderla', () => {
    expect(lineasVistaVigencia(horiba(true, 365), null, HOY).map((l) => [l.texto, l.valor])).toEqual([
      ['Vigencia', '365 días (12 meses) → sin vencimiento'],
      ['Equipos activos de la marca con fecha de calibración', '4'],
      ['Entran en «Avisos a clientes» (vencidas o por vencer)', '0'],
      ['Salen de «Avisos a clientes»', '2'],
      ['Vencidas hace más de un año (no piden aviso)', '0'],
      ['Sin fecha (no vencen ni avisan)', '1'],
    ]);
    expect(lineasVistaVigencia(horiba(false, null), 365, HOY)[2].texto).toBe('Entrarían en «Avisos a clientes» al encenderla');
    expect(efectoVigencia(horiba(false, null), 365)).toMatch(/^La marca no está en seguimiento: Avisos no cambia hasta encenderla\./);
    expect(efectoVigencia(horiba(true, null), 365)).toMatch(/vencen a los 365 días \(12 meses\) de su última calibración.*No se envía ningún correo/);
    expect(efectoVigencia(horiba(true, 365), null)).toMatch(/dejan de vencer.*no salen en Avisos ni en el Calendario.*No se envía ningún correo/);
  });

  it('el apunte de un cambio de vigencia, en una línea', () => {
    expect(textoCambioVigencia({ id: 1, clave: 'horiba', marca: 'Horiba', antes: null, despues: 365, motivo: 'Decisión ficticia.', por: 'director@example.com', en: '2026-10-18 20:00:00+00' })).toBe('Horiba: vigencia sin vencimiento → 365 días (12 meses), por director@example.com el 18/10/2026 15:00: Decisión ficticia.');
  });
});

describe('el filtro de marca de «Equipos»', () => {
  const eq = (clave: string, marcaTexto: string) => ({ clave, marca: marcaTexto }) as EquipoVista;
  const eqs = [eq('A', 'GRIMM'), eq('B', 'Grimm'), eq('C', 'Horiba'), eq('D', 'HORIBA '), eq('E', 'Horiba')];

  it('las marcas del inventario, por su clave, con su forma más escrita y cuántos equipos; de más a menos', () => {
    expect(marcasDeEquipos(eqs)).toEqual([{ clave: 'horiba', marca: 'Horiba', total: 3 }, { clave: 'grimm', marca: 'GRIMM', total: 2 }]);
  });

  it('filtra por la clave («HORIBA» y «Horiba» son la misma); vacío, todos', () => {
    expect(filtrarPorMarca(eqs, 'horiba').map((e) => e.clave)).toEqual(['C', 'D', 'E']);
    expect(filtrarPorMarca(eqs, '')).toHaveLength(5);
  });
});
