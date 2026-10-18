/**
 * La frecuencia de preventivo de un cliente según su contrato (lote 12), tal como la enseña y la cambia la ficha de un equipo. Puro: sin
 * React ni red. La regla es la del servidor (`vigenciaDeGrupo`, marcas.ts): un equipo de una marca «según contrato» vence a los
 * `diasDeMeses(meses)` días de su última calibración; sin frecuencia, no vence. Cambiarla no envía nada: los avisos siguen siendo
 * manuales o simulados.
 */
import { ESTADOS_AVISO, claveCliente, diasDeMeses, esFrecuenciaValida, estadoCalibracion, type CambioFrecuencia, type EquipoVista, type FrecuenciaCliente } from '../dominio';
import type { LineaVigencia } from './marcas';
import { fmtFechaHora } from './vistas';

/** «6 meses (183 días)», «1 mes (30 días)»; sin frecuencia, «sin contrato». */
export const textoMeses = (meses: number | null): string => (meses === null ? 'sin contrato' : `${meses} ${meses === 1 ? 'mes' : 'meses'} (${diasDeMeses(meses)} días)`);

/** La frecuencia guardada de un cliente (por su clave, `claveCliente`), o null si no tiene fila. */
export const frecuenciaDe = (frecuencias: readonly FrecuenciaCliente[], clave: string): FrecuenciaCliente | null => frecuencias.find((f) => f.clave === clave) ?? null;

/** Lo elegido en el formulario: `null` = sin contrato; un entero de meses de 1 a 36; `undefined` = no vale. */
export function frecuenciaElegida(modo: 'sin' | 'meses', texto: string): number | null | undefined {
  if (modo === 'sin') return null;
  const n = /^\s*\d+\s*$/.test(texto) ? Number(texto) : Number.NaN;
  return esFrecuenciaValida(n) && n !== null ? n : undefined;
}

/** Lo que la ficha dice de este equipo y la frecuencia `meses` de su cliente. */
export function textoContrato(e: EquipoVista, meses: number | null): string {
  if (!e.segunContrato) return 'La marca de este equipo no vence según contrato: la frecuencia del cliente sólo cuenta para las marcas «según contrato del cliente».';
  if (meses === null) return 'Su marca vence según el contrato de su cliente y este cliente no tiene frecuencia de preventivo: el equipo no vence ni avisa.';
  return `Su marca vence según el contrato de su cliente: este equipo vence a los ${textoMeses(meses)} de su última calibración.`;
}

/** Los equipos del inventario del cliente `clave` cuya marca vence según contrato: los únicos a los que les afecta su frecuencia. */
export const equiposPorContrato = (equipos: readonly EquipoVista[], clave: string): EquipoVista[] => equipos.filter((e) => e.segunContrato && claveCliente(e.cliente) === clave);

/**
 * La vista previa de pasar la frecuencia del cliente `clave` de `actual` a `nueva`: sobre sus equipos «según contrato» (con su fecha de
 * hoy y la misma regla del servidor), cuántos entran en «Avisos a clientes» y cuántos salen. Lo de antes es lo que ya trae cada equipo.
 */
export function lineasVistaFrecuencia(equipos: readonly EquipoVista[], clave: string, actual: number | null, nueva: number | null, hoy: string): LineaVigencia[] {
  const suyos = equiposPorContrato(equipos, clave);
  const despues = (e: EquipoVista) => estadoCalibracion(e.ultimaCalibracion, hoy, nueva === null ? null : diasDeMeses(nueva)).estado;
  const entran = suyos.filter((e) => !ESTADOS_AVISO.includes(e.estado) && ESTADOS_AVISO.includes(despues(e))).length;
  const salen = suyos.filter((e) => ESTADOS_AVISO.includes(e.estado) && !ESTADOS_AVISO.includes(despues(e))).length;
  return [
    { texto: 'Frecuencia de preventivo', valor: `${textoMeses(actual)} → ${textoMeses(nueva)}`, cambia: true },
    { texto: 'Equipos del cliente que vencen según su contrato', valor: String(suyos.length) },
    { texto: 'Entran en «Avisos a clientes» (vencidas o por vencer)', valor: String(entran), ...(entran > 0 ? { aviso: true } : {}) },
    { texto: 'Salen de «Avisos a clientes»', valor: String(salen) },
    { texto: 'Vencidas hace más de un año (no piden aviso)', valor: String(suyos.filter((e) => despues(e) === 'FUERA_CICLO').length) },
    { texto: 'Sin fecha (no vencen ni avisan)', valor: String(suyos.filter((e) => e.estado === 'SIN_FECHA').length) },
  ];
}

/** Lo que pasa al confirmar, dicho antes. `n` = sus equipos «según contrato». */
export function efectoFrecuencia(n: number, nueva: number | null): string {
  const que =
    n === 0
      ? 'Ningún equipo de este cliente vence hoy según contrato: se guarda y contará cuando su marca vaya «según contrato del cliente».'
      : nueva === null
        ? `Sus ${n} equipos de marcas «según contrato» dejan de vencer: no salen en Avisos ni en el Calendario.`
        : `Sus ${n} equipos de marcas «según contrato» vencen a los ${textoMeses(nueva)} de su última calibración: Resumen, Calendario y Avisos lo recalculan.`;
  return `${que} No se envía ningún correo: los avisos siguen siendo manuales o simulados. Se puede volver a cambiar.`;
}

/** Un apunte del historial de la frecuencia de un cliente, en una línea. */
export const textoCambioFrecuencia = (c: CambioFrecuencia): string => `${textoMeses(c.antes)} → ${textoMeses(c.despues)}, por ${c.por} el ${fmtFechaHora(c.en)}: ${c.motivo}`;
