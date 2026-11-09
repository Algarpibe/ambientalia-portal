/**
 * El correo del aviso a clientes de Trazabilidad: su texto (asunto y cuerpo
 * por tramo) y, desde el envío (2026-11-08), lo que sale de verdad, su versión
 * de prueba y la forma de los envíos que sirve la API.
 *
 * Puro: sólo importa el dominio; sin Node, sin base, sin red y sin reloj. Lo
 * usan el servidor, que redacta con él lo que sale al pulsar «Enviar correo»,
 * y la app del portal, que enseña ese mismo texto antes de enviarlo: los dos
 * dicen siempre lo mismo, letra a letra. `avisos-correo.test.ts` vigila que no
 * gane imports ni llamadas.
 */
import { claveCliente, type CorreoSimulado, type Destinatario, type EquipoAviso, type TramoAviso } from './dominio.js';

/** Lo que el texto del aviso necesita de un equipo (la `EquipoVista` del servidor lo cumple). */
export interface EquipoTexto {
  serial: string;
  marca: string;
  modelo: string;
  ultimaCalibracion: string | null;
  /** AAAA-MM-DD, o null. */
  vence: string | null;
  /** Negativo = vencida hace N días. */
  vigenciaDias: number | null;
}

/** Un día AAAA-MM-DD escrito DD/MM/AAAA, como en la app; sin fecha, «—». Las fechas del aviso son días sueltos: no hay zona que convertir. */
export function fechaDia(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
}

/** La marca de un equipo en el texto de un aviso: «GRIMM», como siempre, o la suya si es de otra marca incluida (lote 9f). */
export const marcaAviso = (e: Pick<EquipoTexto, 'marca'>): string => (claveCliente(e.marca) === 'grimm' ? 'GRIMM' : e.marca.trim());
/** Si todos son GRIMM: entonces el aviso habla de «monitores de partículas GRIMM», como siempre. */
export const todosGrimm = (eqs: readonly Pick<EquipoTexto, 'marca'>[]): boolean => eqs.every((e) => claveCliente(e.marca) === 'grimm');

/** Lo que cambia en el texto del aviso cuando es el de un tramo. */
export interface OpcionesAviso {
  /** El tramo: cambia la frase de entrada. Sin él, el texto genérico de siempre. */
  tramo?: TramoAviso;
  /** La primera línea. Sin ella, «Estimado cliente …:». */
  saludo?: string;
}

/** Cómo empieza la frase de entrada en los tramos de antes del vencimiento: primer aviso, recordatorio y último aviso. */
const ENTRADA_TRAMO: Record<Exclude<TramoAviso, 'vencida'>, string> = {
  90: 'le informamos con antelación de que',
  60: 'le recordamos que',
  30: 'le recordamos, como último aviso, que',
};

/** El párrafo de la propuesta de siempre: el de los tramos 90, 60 y 30 y el del texto sin tramo. */
const PROPUESTA =
  'Para mantener la validez de sus mediciones y evitar paradas no previstas, le proponemos programar desde ahora el servicio de calibración y mantenimiento. Indíquenos la fecha en que podría enviarnos los equipos o, si lo prefiere, coordinamos la recogida.';

/**
 * Texto del aviso al cliente. Con `opciones.tramo` es el de ese tramo: mismo
 * cuerpo, con la frase de entrada propia del tramo; en «vencida» (aprobado el
 * 2026-11-08), además, con su propio párrafo de propuesta.
 */
export function mensajeAviso(cliente: string, equipos: readonly EquipoTexto[], opciones: OpcionesAviso = {}): string {
  const lineas = equipos
    .map((e) => {
      const cuando = (e.vigenciaDias ?? 0) < 0 ? `vencida desde el ${fechaDia(e.vence)}` : `vence el ${fechaDia(e.vence)}`;
      return `• ${marcaAviso(e)} ${e.modelo}, serial ${e.serial}: última calibración ${fechaDia(e.ultimaCalibracion)}, ${cuando}.`;
    })
    .join('\n');
  const plural = equipos.length !== 1;
  // Sólo GRIMM: el texto de siempre. Con equipos de otra marca incluida (lote 9f), «equipos», sin decir de qué son.
  const que = todosGrimm(equipos) ? (plural ? 'los siguientes monitores de partículas GRIMM' : 'el siguiente monitor de partículas GRIMM') : plural ? 'los siguientes equipos' : 'el siguiente equipo';
  const de = plural ? `de ${que}` : `d${que}`;
  const { tramo } = opciones;
  const entrada =
    tramo === undefined
      ? `le recordamos que ${que} ${plural ? 'tienen' : 'tiene'} la calibración vencida o próxima a vencer:`
      : tramo === 'vencida'
        ? `le informamos de que la calibración ${de} está vencida:`
        : `${ENTRADA_TRAMO[tramo]} la calibración ${de} vence en los próximos ${tramo} días:`;
  const propuesta =
    tramo === 'vencida'
      ? `Mientras la calibración esté vencida, las mediciones ${plural ? 'de los equipos' : 'del equipo'} pueden perder su validez. Le proponemos programar cuanto antes el servicio de calibración y mantenimiento. Indíquenos la fecha en que podría enviarnos ${plural ? 'los equipos' : 'el equipo'} o, si lo prefiere, coordinamos la recogida.`
      : PROPUESTA;
  return [
    opciones.saludo ?? `Estimado cliente ${cliente}:`,
    '',
    `Desde el Servicio Técnico de Ambientalia ${entrada}`,
    '',
    lineas,
    '',
    propuesta,
    '',
    'Quedamos atentos.',
    '',
    'Ambientalia S.A.S. · Servicio Técnico',
  ].join('\n');
}

/**
 * La primera línea del correo: por su nombre si entre los destinatarios hay
 * exactamente uno con nombre; si no hay ninguno o hay varios, el saludo
 * genérico al cliente.
 */
export function saludoAviso(cliente: string, destinatarios: readonly Destinatario[]): string {
  const nombres = [...new Set(destinatarios.map((d) => d.nombre.trim()).filter(Boolean))];
  return nombres.length === 1 ? `Estimado/a ${nombres[0]}:` : `Estimado cliente ${cliente}:`;
}

/** Cómo empieza el asunto en cada tramo: primer aviso, recordatorio, último aviso y vencida. */
const ASUNTO_TRAMO: Record<TramoAviso, (monitores: string) => string> = {
  90: (m) => `Calibración de ${m}: vence en los próximos 90 días`,
  60: (m) => `Recordatorio: la calibración de ${m} vence en los próximos 60 días`,
  30: (m) => `Último aviso: la calibración de ${m} vence en los próximos 30 días`,
  vencida: (m) => `La calibración de ${m} está vencida`,
};

/** El nombre de cada tramo en la pantalla: la etiqueta de cada tarjeta y de cada envío. */
export const ETIQUETA_TRAMO: Record<TramoAviso, string> = { 90: 'Primer aviso · 90 días', 60: 'Recordatorio · 60 días', 30: 'Último aviso · 30 días', vencida: 'Vencida' };

export interface CorreoRedactado {
  /** Los destinatarios, separados por comas; vacío si el grupo no tiene a quién. */
  para: string;
  asunto: string;
  cuerpo: string;
}

/** El correo de una tarjeta (cliente + tramo): destinatarios, asunto y cuerpo. */
export function correoAviso<E extends EquipoAviso & EquipoTexto>(c: CorreoSimulado<E>): CorreoRedactado {
  // Sólo GRIMM, como siempre; con equipos de otra marca incluida (lote 9f), «su equipo» / «sus equipos».
  const grimm = todosGrimm(c.equipos.map((x) => x.equipo));
  const monitores = c.equipos.length === 1 ? (grimm ? 'su monitor GRIMM' : 'su equipo') : grimm ? 'sus monitores GRIMM' : 'sus equipos';
  return {
    para: c.destinatarios.map((d) => d.email).join(', '),
    asunto: `${ASUNTO_TRAMO[c.tramo](monitores)} · ${c.cliente}`,
    cuerpo: mensajeAviso(
      c.cliente,
      c.equipos.map((x) => x.equipo),
      { tramo: c.tramo, saludo: saludoAviso(c.cliente, c.destinatarios) },
    ),
  };
}
