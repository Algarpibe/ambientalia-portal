/**
 * Lo que calcula la tarjeta «Marcas en seguimiento» de Configuración (lote 9f),
 * la línea de la cabecera y el filtro de marca de «Equipos». Puro: sin React
 * ni red. Los recuentos llegan hechos del servidor (GET /marcas); aquí sólo se
 * redactan. Encender una marca no envía nada: los avisos siguen siendo
 * manuales o simulados.
 */
import { claveMarca, type CambioMarca, type EquipoVista, type MarcaSeguimiento } from '../dominio';
import { fmtFechaHora } from './vistas';

/** «GRIMM EDM 180 + Horiba»: las marcas incluidas, GRIMM EDM 180 delante. Sin la lista, la de siempre. */
export function textoMarcas(marcas: readonly MarcaSeguimiento[] | null): string {
  const incluidas = (marcas ?? []).filter((m) => m.incluida).map((m) => m.marca);
  return incluidas.length > 0 ? incluidas.join(' + ') : 'GRIMM EDM 180';
}

export interface LineaVistaPrevia { texto: string; valor: number; cambia?: boolean; aviso?: boolean }

/** La vista previa de encender una marca (si está apagada) o de apagarla (si está encendida), línea a línea. */
export function lineasVistaPrevia(m: MarcaSeguimiento): LineaVistaPrevia[] {
  const r = m.resumen;
  if (m.incluida) {
    return [
      { texto: 'Equipos que salen de Resumen, Equipos, Calendario y Avisos', valor: r.equipos, cambia: true },
      { texto: 'De ellos, salen de «Avisos a clientes»', valor: r.avisos },
      { texto: '· de clientes distintos', valor: r.clientesAvisos },
    ];
  }
  return [
    { texto: 'Equipos que entran en Resumen, Equipos, Calendario y Avisos', valor: r.equipos, cambia: true },
    { texto: 'De ellos, entran en «Avisos a clientes» (vencidas o por vencer)', valor: r.avisos, aviso: r.avisos > 0 },
    { texto: '· de clientes distintos', valor: r.clientesAvisos },
    { texto: 'Vencidas hace más de un año (no piden aviso)', valor: r.porEstado.FUERA_CICLO },
    { texto: 'Sin fecha (no piden aviso)', valor: r.porEstado.SIN_FECHA },
    { texto: 'Al día', valor: r.porEstado.AL_DIA },
    { texto: 'Filas de partida que nacen (la fecha de la hoja, guardada con su equipo)', valor: r.partidas },
    { texto: 'Calibraciones sueltas que se enlazan con su equipo', valor: r.enlazadas },
  ];
}

/** Lo que pasa al confirmar, dicho antes. */
export function efectoMarca(m: MarcaSeguimiento): string {
  const n = m.resumen.equipos;
  return m.incluida
    ? `Sus ${n} equipos activos salen de Resumen, Equipos, Calendario y Avisos. Nada se borra: su seguimiento y sus calibraciones se conservan y la pestaña «Trazabilidad F-ST-022» los sigue enseñando. Se puede volver a encender.`
    : `Sus ${n} equipos activos entran en Resumen, Equipos, Calendario y Avisos con la misma fecha de calibración que hoy enseña la pestaña «Trazabilidad F-ST-022». No se envía ningún correo: los avisos siguen siendo manuales o simulados. Un equipo que ya no se atiende se retira como siempre, y la marca se puede volver a apagar.`;
}

/** Un apunte del historial de cambios, en una línea. */
export function textoCambioMarca(c: CambioMarca): string {
  const escrito = c.accion === 'incluir' ? `; ${c.partidas} partidas y ${c.enlazadas} enlazadas` : '';
  return `${c.marca} ${c.accion === 'incluir' ? 'encendida' : 'apagada'} por ${c.por} el ${fmtFechaHora(c.en)} (${c.equipos} equipos${escrito}): ${c.motivo}`;
}

/** Las marcas de los equipos del inventario, por su clave, con su forma más escrita y cuántos equipos; de más a menos. */
export function marcasDeEquipos(eqs: readonly EquipoVista[]): { clave: string; marca: string; total: number }[] {
  const grupos = new Map<string, Map<string, number>>();
  for (const e of eqs) {
    const formas = grupos.get(claveMarca(e.marca)) ?? new Map<string, number>();
    grupos.set(claveMarca(e.marca), formas.set(e.marca.trim(), (formas.get(e.marca.trim()) ?? 0) + 1));
  }
  return [...grupos]
    .map(([clave, formas]) => ({ clave, marca: [...formas].reduce((a, b) => (b[1] > a[1] ? b : a))[0], total: [...formas.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave));
}

/** Los equipos de esa marca (por su clave); sin marca elegida, todos. */
export const filtrarPorMarca = <E extends Pick<EquipoVista, 'marca'>>(eqs: readonly E[], clave: string): E[] => eqs.filter((e) => clave === '' || claveMarca(e.marca) === clave);
