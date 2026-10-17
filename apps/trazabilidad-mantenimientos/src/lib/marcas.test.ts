import { describe, it, expect } from 'vitest';
import type { EquipoVista, MarcaSeguimiento, ResumenMarca } from '../dominio';
import { efectoMarca, filtrarPorMarca, lineasVistaPrevia, marcasDeEquipos, textoCambioMarca, textoMarcas } from './marcas';

// Lo que calcula la tarjeta «Marcas en seguimiento» (lote 9f), la cabecera y el
// filtro de marca de «Equipos». Sólo recuentos y textos: nada de esto envía nada.

const VACIO: ResumenMarca = { equipos: 0, porEstado: { FUERA_CICLO: 0, VENCIDA: 0, VENCE_30: 0, VENCE_60: 0, VENCE_90: 0, AL_DIA: 0, SIN_FECHA: 0 }, avisos: 0, clientesAvisos: 0, partidas: 0, enlazadas: 0 };
const marca = (clave: string, nombre: string, incluida: boolean, resumen: Partial<ResumenMarca> = {}): MarcaSeguimiento => ({ clave, marca: nombre, fija: clave === 'grimm edm 180', incluida, firma: null, resumen: { ...VACIO, ...resumen } });
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
