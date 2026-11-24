/**
 * La tabla «Plazos por tipo de servicio» de «Configuración»: lo escrito en una
 * casilla de días y en la fila de crear un tipo (2026-11-24), y los textos de
 * crear y borrar. Puro: sin React ni red. El nombre de un tipo nuevo se valida
 * con la regla del servidor (`errorNombreTipo`, dominio.ts) y los días con la
 * de siempre (`leerEntero`: de 1 a 365, o vacío). Que ya exista sólo lo sabe el
 * servidor (409 `tipo_existente`).
 */
import { PLAZO_MAX_DIAS, PLAZO_MIN_DIAS, errorNombreTipo } from '../dominio';
import { leerEntero } from './agenda';

/** Lo escrito en una casilla de días hábiles: un entero de 1 a 365, o vacío (sin plazo). */
export function leerDias(txt: string): { dias: number | null } | { error: string } {
  const v = leerEntero(txt, { min: PLAZO_MIN_DIAS, max: PLAZO_MAX_DIAS, vacio: true });
  return 'error' in v ? v : { dias: v.valor };
}

/** La fila de crear un tipo, leída. */
export interface LecturaTipoNuevo {
  /** Lo que se manda al pulsar «Crear»; null si falta el nombre o alguna casilla no vale. */
  nuevo: { tipo: string; dias: number | null } | null;
  /** Por qué no vale el nombre; null si vale y también mientras no se ha escrito nada (una fila vacía no sale en rojo). */
  errorNombre: string | null;
  errorDias: string | null;
}

/** Lee la fila de crear: el nombre sin los espacios de los extremos y los días; con el error de cada casilla. */
export function leerTipoNuevo(nombre: string, dias: string): LecturaTipoNuevo {
  const tipo = nombre.trim();
  const errorNombre = tipo === '' ? null : errorNombreTipo(tipo);
  const d = leerDias(dias);
  const errorDias = 'error' in d ? d.error : null;
  return { nuevo: tipo !== '' && errorNombre === null && !('error' in d) ? { tipo, dias: d.dias } : null, errorNombre, errorDias };
}

/** El aviso tras crear un tipo. */
export const avisoCreado = (etiqueta: string): string => `Tipo «${etiqueta}» creado`;

/** El aviso tras borrarlo. */
export const avisoBorrado = (etiqueta: string): string => `Tipo «${etiqueta}» borrado`;

/** La pregunta que sale en la propia fila al pulsar «Borrar» (sin diálogo del navegador). */
export const preguntaBorrar = (etiqueta: string): string => `¿Borrar «${etiqueta}»? También se borran sus días en la agenda.`;
