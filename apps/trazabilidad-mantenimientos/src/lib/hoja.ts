/**
 * Pestaña «Trazabilidad F-ST-022» (lote 9d-1): lo que calcula la pantalla con
 * la tabla que da el servidor —filtros, orden, contador y textos—. Puro, sin
 * reloj ni red: qué fila es de qué equipo, su fecha y su estado los decide
 * hub-api (`hoja.ts`).
 */
import { claveCliente, type AvisoHoja, type CalibracionHoja, type EstadoCalibracion, type FilaHoja, type Retiro, type SituacionHoja } from '../dominio';
import { origenCalibracion } from './calibraciones';
import { fmtFecha, ordenVigencia } from './vistas';

/** Cada aviso de una fila, en claro. */
export const ETIQUETA_AVISO: Record<AvisoHoja, string> = {
  sin_serial: 'Sin serial',
  serial_repetido: 'Serial repetido en la hoja',
  serial_numerico: 'Serial numérico: pudo perder ceros a la izquierda',
  sin_fecha: 'Sin fecha de calibración',
  en_revision: 'Tiene una fecha en revisión (posterior a hoy, imposible o de un serial ambiguo): no cuenta',
  calibraciones_sin_atribuir: 'Hay calibraciones de tickets con este serial y no se sabe de cuál de las filas son',
  marca_distinta: 'Marca escrita de otra forma que el resto',
  modelo_distinto: 'Modelo escrito de otra forma que el resto',
};
/** El aviso en corto, para la etiqueta de la fila (el texto entero va en su `title` y en el panel). */
export const AVISO_CORTO: Record<AvisoHoja, string> = {
  sin_serial: 'sin serial',
  serial_repetido: 'serial repetido',
  serial_numerico: 'serial numérico',
  sin_fecha: 'sin fecha',
  en_revision: 'fecha en revisión',
  calibraciones_sin_atribuir: 'calibraciones sin atribuir',
  marca_distinta: 'marca escrita distinto',
  modelo_distinto: 'modelo escrito distinto',
};
/** «En el inventario» = en seguimiento (los GRIMM EDM 180 y, desde el lote 9f, los de una marca encendida); «enlazado» = otra marca, con sus datos del maestro pero fuera de seguimiento (lote 9d-2a). */
export const ETIQUETA_SITUACION: Record<SituacionHoja, string> = { inventario: 'En el inventario', inactivo: 'En el inventario · inactivo', enlazado: 'Enlazado con Desk 2.0 · fuera de seguimiento', hoja: 'Sólo en la hoja' };
/** Por qué una fila que no abre ficha de equipo no entra en Resumen ni Avisos, y dónde se corrige (la nota de su panel). */
export const NOTA_SITUACION: Record<SituacionHoja, string> = {
  inventario: 'Este equipo está en el inventario, en seguimiento (es un GRIMM EDM 180 o su marca está encendida en «Configuración»).',
  inactivo: 'Este equipo está en el inventario, pero inactivo: no entra en Resumen, Equipos, Calendario ni Avisos.',
  enlazado: 'Este equipo está enlazado con Desk 2.0, fuera de seguimiento: su cliente, marca, modelo y serial salen del maestro (se corrigen en Desk 2.0 y se sincroniza), pero no entra en Resumen, Equipos, Calendario ni Avisos, y no genera avisos.',
  hoja: 'Este equipo sólo está en la hoja: no tiene equipo activo en Desk 2.0 con el que enlazarlo (o su serial se repite), así que no entra en Resumen, Equipos, Calendario ni Avisos.',
};
export const etiquetaMarca = (marca: string): string => marca || '(sin marca)';
/** Cuántas filas hay de cada situación (la de las enlazadas no viene en el resumen del servidor). */
export function porSituacion(filas: readonly FilaHoja[]): Record<SituacionHoja, number> {
  const n: Record<SituacionHoja, number> = { inventario: 0, inactivo: 0, enlazado: 0, hoja: 0 };
  for (const f of filas) n[f.situacion]++;
  return n;
}

export interface FiltroHoja {
  /** Busca en cliente, serial y modelo (también en lo que decía la hoja). */
  texto: string;
  /** Claves de marca (`marcaClave`); vacío = todas. */
  marcas: string[];
  estados: EstadoCalibracion[];
  /** `inventario` incluye los inactivos (es lo que está en seguimiento); `enlazado`, las otras marcas enlazadas con Desk 2.0. */
  situacion: '' | 'inventario' | 'enlazado' | 'hoja';
  soloAvisos: boolean;
  /** Sólo lo retirado a mano (un equipo, o una fila de la hoja). Sin él salen todas; «sólo en la hoja» es entonces lo vivo, como su cifra. */
  retirados: boolean;
}
export const FILTRO_HOJA_VACIO: FiltroHoja = { texto: '', marcas: [], estados: [], situacion: '', soloAvisos: false, retirados: false };

export const hayFiltroHoja = (f: FiltroHoja): boolean => f.texto.trim() !== '' || f.marcas.length > 0 || f.estados.length > 0 || f.situacion !== '' || f.soloAvisos || f.retirados;

// ── Retirar y reincorporar (lote 9d-2b) ──

export const textoRetiro = (r: Retiro): string => `Retirado a mano por ${r.por} el ${fmtFecha(r.en)}: ${r.motivo}`;

/** Lo que se puede hacer con esa fila (lo ofrece la pantalla a quien tiene `inventario.write`), o null: un equipo inactivo que nadie retiró no se retira ni se reincorpora aquí. */
export interface AccionRetiro { de: 'equipo' | 'fila'; retirar: boolean; destino: { clave: string } | { fila: number } }
export function accionRetiro(f: Pick<FilaHoja, 'clave' | 'fila' | 'situacion' | 'retirado'>): AccionRetiro | null {
  const retirar = f.retirado === null;
  if (f.clave !== null) return retirar && f.situacion === 'inactivo' ? null : { de: 'equipo', retirar, destino: { clave: f.clave } };
  return f.fila === null ? null : { de: 'fila', retirar, destino: { fila: f.fila } };
}

/** Lo que pasa al retirar o reincorporar, para decirlo antes de confirmar. */
export function efectoRetiro({ de, retirar }: Pick<AccionRetiro, 'de' | 'retirar'>): string {
  if (de === 'fila') return retirar ? 'La fila se sigue viendo, atenuada, pero deja de contar en los totales de la pestaña. La hoja congelada no se toca y se puede deshacer.' : 'La fila vuelve a contar en los totales de la pestaña.';
  return retirar
    ? 'El equipo sale de Resumen, Equipos, Calendario y Avisos. No se borra: conserva su seguimiento y sus calibraciones, y se puede reincorporar. En Desk 2.0 sigue existiendo: al sincronizar el maestro no se reactiva mientras siga retirado aquí.'
    : 'El equipo vuelve a estar activo y vuelve a seguir al maestro: si en Desk 2.0 está inactivo, la próxima sincronización lo desactivará.';
}

export function filtrarHoja(filas: readonly FilaHoja[], f: FiltroHoja): FilaHoja[] {
  const q = claveCliente(f.texto);
  return filas.filter(
    (x) =>
      (f.marcas.length === 0 || f.marcas.includes(x.marcaClave)) &&
      (f.estados.length === 0 || f.estados.includes(x.estado)) &&
      (f.situacion === '' || (x.situacion === 'inactivo' ? 'inventario' : x.situacion) === f.situacion) &&
      (f.retirados ? x.retirado !== null : f.situacion !== 'hoja' || x.retirado === null) &&
      (!f.soloAvisos || x.avisos.length > 0) &&
      (q === '' || [x.cliente, x.serial, x.modelo, x.enHoja.cliente, x.enHoja.serial, x.enHoja.modelo].some((t) => t !== undefined && claveCliente(t).includes(q))),
  );
}

/** «12 de 366 equipos», o «366 equipos» si se ven todos. */
export function textoContador(visibles: number, total: number): string {
  return `${visibles === total ? '' : `${visibles} de `}${total} equipo${total === 1 ? '' : 's'}`;
}

export type ColumnaHoja = 'fila' | 'cliente' | 'marca' | 'modelo' | 'serial' | 'ultimaCalibracion' | 'vigencia' | 'situacion';
export interface OrdenHoja { k: ColumnaHoja; dir: 1 | -1 }
/** El orden de la hoja congelada. */
export const ORDEN_HOJA: OrdenHoja = { k: 'fila', dir: 1 };

const ORDEN_SITUACION: Record<SituacionHoja, number> = { inventario: 0, inactivo: 1, enlazado: 2, hoja: 3 };

/** La lista ordenada (una copia). A igualdad, el orden de la hoja; las que no tienen fecha, siempre al final. */
export function ordenarHoja(filas: readonly FilaHoja[], { k, dir }: OrdenHoja): FilaHoja[] {
  const val = (f: FilaHoja): string | number | null => {
    switch (k) {
      case 'fila':
        return f.fila ?? Infinity;
      case 'cliente':
      case 'modelo':
        return claveCliente(f[k]);
      case 'marca':
        return f.marcaClave;
      case 'serial':
        return f.serial;
      case 'ultimaCalibracion':
        return f.ultimaCalibracion;
      case 'vigencia':
        // Como en «Equipos»: lo urgente arriba; «vencida +1 año», «sin vencimiento» y «sin fecha», al final.
        return ordenVigencia(f);
      case 'situacion':
        return ORDEN_SITUACION[f.situacion];
    }
  };
  return [...filas].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === null || y === null) return x === y ? (a.fila ?? Infinity) - (b.fila ?? Infinity) : x === null ? 1 : -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.fila ?? Infinity) - (b.fila ?? Infinity);
  });
}

/** De dónde sale una calibración conocida de una fila: la hoja congelada, un ticket o una corrección manual. */
export const origenDe = (c: Pick<CalibracionHoja, 'origen' | 'ticket' | 'corrigeTicket'>): string => (c.origen === 'fst022' ? 'Hoja F-ST-022' : origenCalibracion(c));

/** De dónde sale la última calibración de la fila; vacío si no tiene. */
export function origenFecha(f: FilaHoja): string {
  const c = f.calibraciones.find((x) => x.cuenta);
  return c ? origenDe(c) : f.ultimaCalibracion ? 'Inventario del portal' : '';
}

/** Lo que decía la hoja congelada en ese campo (lo mismo que hoy, si no ha cambiado); null si el equipo no está en la hoja o la hoja no traía fecha. */
export function valorEnHoja(f: FilaHoja, campo: 'cliente' | 'marca' | 'modelo' | 'serial' | 'ultimaCalibracion'): string | null {
  if (f.fila === null) return null;
  return campo in f.enHoja ? (f.enHoja[campo] ?? null) : f[campo];
}
