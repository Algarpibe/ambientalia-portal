/**
 * Lo que calcula la tarjeta «Marcas en seguimiento» de Configuración (lote 9f),
 * la línea de la cabecera y el filtro de marca de «Equipos». Puro: sin React
 * ni red. Los recuentos llegan hechos del servidor (GET /marcas); aquí sólo se
 * redactan. Encender una marca no envía nada: los avisos siguen siendo
 * manuales o simulados.
 */
import { ESTADOS_AVISO, SEGUN_CONTRATO, claveMarca, esVigenciaValida, estadoCalibracion, valorVigencia, type CambioMarca, type CambioVigencia, type EquipoVista, type MarcaSeguimiento, type ValorVigencia } from '../dominio';
import { fmtFechaHora } from './vistas';

// ── Vigencia de calibración por marca (lote 11) ─────────────────────────────
// GRIMM, 365 días; Horiba y las demás, sin vencimiento hasta que se les ponga un plazo. Se guarda en días; en pantalla, también en meses.

const DIAS_MES = 365.25 / 12;

/** «12 meses», «1 mes», «unos 6 meses» (si no es un número de meses casi exacto, redondeado a medio mes). */
function meses(dias: number): string {
  const m = dias / DIAS_MES;
  const r = Math.round(m);
  if (Math.abs(m - r) < 0.05) return r === 1 ? '1 mes' : `${r} meses`;
  const medio = Math.round(m * 2) / 2;
  return `unos ${String(medio).replace('.', ',')} ${medio === 1 ? 'mes' : 'meses'}`;
}

/** «365 días (12 meses)»; sin plazo, «sin vencimiento». */
export const textoDias = (dias: number | null): string => (dias === null ? 'sin vencimiento' : `${dias} días (${meses(dias)})`);

/** La vigencia de una marca en palabras: «según contrato del cliente» (lote 12) o la de `textoDias`. */
export const textoValorVigencia = (v: ValorVigencia): string => (v === SEGUN_CONTRATO ? 'según contrato del cliente' : textoDias(v));

/** La vigencia de las marcas incluidas, para la cabecera: «12 meses» si todas tienen la misma; si no, por grupos. Sin la lista, la de GRIMM. */
export function textoVigencias(marcas: readonly MarcaSeguimiento[] | null): string {
  const grupos = new Map<ValorVigencia, string[]>();
  for (const m of (marcas ?? []).filter((x) => x.incluida)) grupos.set(valorVigencia(m.vigencia), [...(grupos.get(valorVigencia(m.vigencia)) ?? []), m.marca]);
  const valor = (d: ValorVigencia) => (d === SEGUN_CONTRATO ? 'según contrato' : d === null ? 'sin vencimiento' : meses(d));
  const nombres = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`);
  if (grupos.size < 2) return `vigencia de calibración: ${valor(grupos.size === 1 ? [...grupos.keys()][0] : 365)}`;
  return `vigencia de calibración: ${[...grupos].map(([d, xs]) => `${nombres(xs)}, ${valor(d)}`).join('; ')}`;
}

/** Lo elegido en el formulario: `null` = sin vencimiento; `'contrato'` = según contrato (lote 12); un entero de días de 30 a 1095; `undefined` = no vale. */
export function vigenciaElegida(modo: 'sin' | 'dias' | 'contrato', texto: string): ValorVigencia | undefined {
  if (modo === 'sin') return null;
  if (modo === 'contrato') return SEGUN_CONTRATO;
  const n = /^\s*\d+\s*$/.test(texto) ? Number(texto) : Number.NaN;
  return esVigenciaValida(n) ? n : undefined;
}

export interface LineaVigencia { texto: string; valor: string; cambia?: boolean; aviso?: boolean }

/**
 * La vista previa de cambiar la vigencia de una marca a `nuevo`, sobre las últimas calibraciones de sus equipos activos (`resumen.fechas`,
 * sólo fechas) y con la misma regla del servidor (`estadoCalibracion`): cuántos entran en «Avisos a clientes» y cuántos salen. Con «según
 * contrato» (lote 12), cada fecha cuenta con los días del contrato de su cliente (`resumen.contratos`, en el mismo orden; null = sin él).
 */
export function lineasVistaVigencia(m: MarcaSeguimiento, nuevo: ValorVigencia, hoy: string): LineaVigencia[] {
  const fechas = m.resumen.fechas;
  const contratos = m.resumen.contratos ?? [];
  const actual = valorVigencia(m.vigencia);
  const dias = (v: ValorVigencia, i: number): number | null => (v === SEGUN_CONTRATO ? (contratos[i] ?? null) : v);
  const estado = (i: number, v: ValorVigencia) => estadoCalibracion(fechas[i], hoy, dias(v, i)).estado;
  const enAvisos = (i: number, v: ValorVigencia) => ESTADOS_AVISO.includes(estado(i, v));
  const indices = fechas.map((_, i) => i);
  const entran = indices.filter((i) => !enAvisos(i, actual) && enAvisos(i, nuevo)).length;
  const salen = indices.filter((i) => enAvisos(i, actual) && !enAvisos(i, nuevo)).length;
  const fuera = indices.filter((i) => estado(i, nuevo) === 'FUERA_CICLO').length;
  return [
    { texto: 'Vigencia', valor: `${textoValorVigencia(actual)} → ${textoValorVigencia(nuevo)}`, cambia: true },
    { texto: 'Equipos activos de la marca con fecha de calibración', valor: String(fechas.length) },
    { texto: m.incluida ? 'Entran en «Avisos a clientes» (vencidas o por vencer)' : 'Entrarían en «Avisos a clientes» al encenderla', valor: String(entran), ...(entran > 0 ? { aviso: true } : {}) },
    { texto: m.incluida ? 'Salen de «Avisos a clientes»' : 'Ya no entrarían en «Avisos a clientes» al encenderla', valor: String(salen) },
    { texto: 'Vencidas hace más de un año (no piden aviso)', valor: String(fuera) },
    { texto: 'Sin fecha (no vencen ni avisan)', valor: String(m.resumen.porEstado.SIN_FECHA) },
    ...(nuevo === SEGUN_CONTRATO ? [{ texto: 'De ellos, de clientes sin frecuencia de preventivo (siguen sin vencimiento)', valor: String(indices.filter((i) => dias(nuevo, i) === null).length) }] : []),
  ];
}

/** Lo que pasa al confirmar el cambio de vigencia, dicho antes. */
export function efectoVigencia(m: MarcaSeguimiento, nuevo: ValorVigencia): string {
  const antes = m.incluida ? '' : 'La marca no está en seguimiento: Avisos no cambia hasta encenderla. ';
  const que =
    nuevo === SEGUN_CONTRATO
      ? 'Cada equipo vence según la frecuencia de preventivo de su cliente (se pone en la ficha de un equipo, sólo un administrador del portal); los de un cliente sin frecuencia siguen sin vencimiento.'
      : nuevo === null
        ? 'Sus equipos dejan de vencer: siguen en Equipos y en la pestaña «Trazabilidad F-ST-022» con su última calibración, pero no salen en Avisos ni en el Calendario.'
        : `Sus equipos vencen a los ${textoDias(nuevo)} de su última calibración: Resumen, Calendario y Avisos lo recalculan al volver a leer.`;
  return `${antes}${que} No se envía ningún correo: los avisos siguen siendo manuales o simulados. Se puede volver a cambiar.`;
}

/** Un apunte del historial de vigencias, en una línea. */
export const textoCambioVigencia = (c: CambioVigencia): string => `${c.marca}: vigencia ${textoValorVigencia(c.antes)} → ${textoValorVigencia(c.despues)}, por ${c.por} el ${fmtFechaHora(c.en)}: ${c.motivo}`;

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
