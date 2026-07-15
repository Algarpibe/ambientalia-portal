// Reconciliación de la configuración de columnas guardada en localStorage con la
// que define el código. Vive fuera del componente para poder testearla: es lógica
// de migración, que falla en silencio y solo se nota meses después.
//
// La regla que faltaba: hay que sincronizar en los DOS sentidos. Esto solo sabía
// AÑADIR columnas nuevas, así que una columna retirada del código sobrevivía para
// siempre en el navegador de quien ya la tuviera guardada — le pasó al "# OC", que
// se borró del código y siguió apareciendo.
import type { ColumnConfig } from '../components/SortableColumnItem';

/**
 * Orden de columnas por pestaña: respeta el orden guardado por el usuario, purga
 * las columnas (y pestañas) que ya no existen en el código, y añade al final las
 * que se hayan incorporado.
 */
export function mergeColumnOrder(
  saved: Record<string, ColumnConfig[]>,
  defaults: Record<string, ColumnConfig[]>,
): Record<string, ColumnConfig[]> {
  const result: Record<string, ColumnConfig[]> = {};
  Object.keys(defaults).forEach((tab) => {
    const savedTab = saved[tab];
    if (!savedTab) {
      result[tab] = [...defaults[tab]];
      return;
    }
    const validKeys = new Set(defaults[tab].map((c) => c.key));
    // Se conserva el orden guardado, pero solo de columnas que sigan existiendo.
    const kept = savedTab.filter((c) => validKeys.has(c.key));
    const keptKeys = new Set(kept.map((c) => c.key));
    defaults[tab].forEach((c) => {
      if (!keptKeys.has(c.key)) kept.push(c);
    });
    result[tab] = kept;
  });
  return result;
}

/**
 * Columnas visibles por pestaña: descarta las que ya no existen y las pestañas que
 * desaparecieron.
 *
 * OJO: no da por visibles las columnas nuevas. El formato guardado es una lista de
 * columnas VISIBLES, así que no distingue "el usuario la ocultó" de "no existía
 * cuando guardó" — de ahí que quien añade una columna tenga que activarla a mano en
 * el componente. Arreglarlo de verdad pide guardar las OCULTAS en vez de las
 * visibles; entonces lo nuevo sería visible por defecto y lo oculto seguiría oculto.
 */
export function pruneColumnVisibility(
  saved: Record<string, string[]>,
  defaults: Record<string, ColumnConfig[]>,
): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {};
  Object.keys(defaults).forEach((tab) => {
    const validKeys = defaults[tab].map((c) => c.key);
    const savedTab = saved[tab];
    if (!savedTab) {
      result[tab] = new Set(validKeys);
      return;
    }
    const valid = new Set(validKeys);
    result[tab] = new Set(savedTab.filter((k) => valid.has(k)));
  });
  return result;
}
